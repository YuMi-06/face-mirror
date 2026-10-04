/**
 * 人脸追踪层：加载本地 MediaPipe tasks-vision，逐帧输出关键点与 blendshape。
 *
 * 两种运行模式：
 *  1) 本机服务模式（http://127.0.0.1:...）：wasm 与模型都从 vendor/ 直接取；
 *  2) 单文件模式（file:// 双击打开）：浏览器禁止 fetch 本地文件，所以
 *     - 胶水层改走 data: URL（MediaPipe 用 <script crossorigin="anonymous"> 加载，
 *       本地文件必被 CORS 拒，实测 data: 可以）；
 *     - wasm 二进制自己解码成字节交给 Module.wasmBinary（也留了 data: URL 兜底）；
 *     - 模型改走 modelAssetBuffer（内存里的 Uint8Array，根本不用取文件）。
 *     这三件事都由 index.html 里的 window.__FM_STANDALONE 提供，且它在应用脚本**之后**执行，
 *     所以要等（等不到就是文件不完整）。
 */
import { FaceLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';

const STANDALONE_AT_LOAD = globalThis.__FM_STANDALONE || null;

/**
 * 相对路径 → 绝对 URL。
 * ⚠️ 不能直接 `new URL(rel, document.baseURI)`：有些上下文（预览器把文档塞进
 * blob:/data: 里打开时）baseURI 不能当基址，会抛 `TypeError: Failed to construct 'URL'`。
 * 而且这些地址只有在「源码 / 本机服务模式」下才会用到，所以先退化成相对路径也没关系。
 */
function vendorUrl(rel) {
  try {
    return new URL(rel, document.baseURI).href;
  } catch {
    try {
      return new URL(rel, location.href).href;
    } catch {
      return rel;
    }
  }
}

/** base64 → Uint8Array（分块解码，比逐字符快） */
function b64ToBytes(b64) {
  const bin = atob(b64);
  const n = bin.length;
  const out = new Uint8Array(n);
  const CHUNK = 65536;
  for (let i = 0; i < n; i += CHUNK) {
    const end = Math.min(i + CHUNK, n);
    for (let j = i; j < end; j++) out[j] = bin.charCodeAt(j);
  }
  return out;
}
/**
 * 单文件版里应用脚本排在资源脚本**前面**（这样万一文档被截断，丢的是资源而不是程序，
 * 界面和报错都还能出来），所以这里要等一下内联资源。
 * file:// 下等不到 = 文件不完整，直接给可读的错误，而不是黑屏卡住。
 */
async function waitForStandalone(timeoutMs = 5000) {
  if (globalThis.__FM_STANDALONE) return globalThis.__FM_STANDALONE;
  if (location.protocol !== 'file:') return null;
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (globalThis.__FM_STANDALONE) return globalThis.__FM_STANDALONE;
  }
  return null;
}

const OPTIONS = {
  runningMode: 'VIDEO',
  // 多人一起用：同时能跟多少张脸。8 是实测比较稳的上限——每多一张脸就多跑一次关键点模型，
  // 人数多时帧率会掉（界面右下角能看到 fps），想再加就改这个数（MediaPipe 允许更大，但会更慢）。
  numFaces: 8,
  outputFaceBlendshapes: true,
  outputFacialTransformationMatrixes: false,
  minFaceDetectionConfidence: 0.4,
  minFacePresenceConfidence: 0.4,
  minTrackingConfidence: 0.4,
};

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.delegate = 'GPU';
    /** @type {number} 上一次成功检测的时间戳，用于诊断 */
    this.lastDetectAt = 0;
    this.failStreak = 0;
  }

  async init() {
    const T = (globalThis.__fmTimings = globalThis.__fmTimings || {});
    T.decodeStart = performance.now();
    const standalone = await waitForStandalone();
    if (!standalone && location.protocol === 'file:') {
      throw new Error(
        '内联资源没有加载到：这个 HTML 很可能不完整（文件尾部被截断）。请重新复制 / 重新生成 五官镜像.html，或用「启动-面容镜像.bat」走源码版。'
      );
    }
    let baseOptions;
    if (standalone) {
      // file:// / 严格 CSP 的预览面板里都不许加载外部资源，所以：
      //  - 胶水层已经由单文件版内联成普通 <script>（它把 window.ModuleFactory 挂上）；
      //    这里把 wasmLoaderPath 置空，MediaPipe 就会**跳过**它自己的 <script src> 加载
      //    —— 那一步用的是 data: URL，会被预览面板的 CSP 拦掉（表现为 [object Event]）。
      //  - wasm 二进制自己 base64 解码成字节，交给 Emscripten 的 Module.wasmBinary（不 fetch）。
      //  - 模型同样是内存里的 Uint8Array（modelAssetBuffer），根本不取文件。
      if (typeof globalThis.ModuleFactory !== 'function') {
        throw new Error(
          '运行时胶水层没有就绪（window.ModuleFactory 缺失）：多半是打开它的程序（预览面板）禁止了内联脚本。请用资源管理器双击，让 Edge 打开这个文件。'
        );
      }
      const wasmBytes = b64ToBytes(standalone.wasmB64);
      const modelBytes = b64ToBytes(standalone.modelB64);
      globalThis.Module = { wasmBinary: wasmBytes };
      this.filesetOverride = {
        wasmLoaderPath: '', // ← 空字符串：MediaPipe 会跳过脚本加载
        // 兜底：万一这个版本的 Emscripten 不认 Module.wasmBinary，它还会去取这个 URL
        wasmBinaryPath: 'data:application/wasm;base64,' + standalone.wasmB64,
      };
      baseOptions = { modelAssetBuffer: modelBytes, delegate: 'GPU' };
    } else {
      // 源码 / 本机服务模式：wasm 与模型都从 vendor/ 取（这里的 baseURI 一定是可用的 http://）
      baseOptions = { modelAssetPath: vendorUrl('vendor/models/face_landmarker.task'), delegate: 'GPU' };
      this.filesetOverride = null;
      this.wasmDir = vendorUrl('vendor/mediapipe/wasm');
    }
    T.decodeEnd = performance.now();

    T.filesetStart = performance.now();
    const fileset = await FilesetResolver.forVisionTasks(this.wasmDir || STANDALONE_AT_LOAD?.wasmDir || 'vendor/mediapipe/wasm');
    if (this.filesetOverride) Object.assign(fileset, this.filesetOverride);
    T.filesetEnd = performance.now();

    // 先试 GPU；部分机器 / 驱动不支持时退回 CPU（慢一些但一定能跑）
    T.createStart = performance.now();
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, { ...OPTIONS, baseOptions });
      this.delegate = 'GPU';
    } catch (gpuErr) {
      console.warn('[track] GPU 委托不可用，退回 CPU：', gpuErr);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
        ...OPTIONS,
        baseOptions: { ...baseOptions, delegate: 'CPU' },
      });
      this.delegate = 'CPU';
    }
    T.createEnd = performance.now();
    return this;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs 必须单调递增
   * @returns {Array<{landmarks:any[], blendshapes:Record<string,number>, box:{x0:number,y0:number,x1:number,y1:number}}>}
   *          这一帧里的**所有人脸**（0 ~ numFaces 张）
   */
  detect(video, timestampMs) {
    if (!this.landmarker || video.readyState < 2) return [];
    let result;
    try {
      result = this.landmarker.detectForVideo(video, timestampMs);
    } catch (err) {
      this.failStreak += 1;
      if (this.failStreak < 4) return [];
      throw err;
    }
    this.failStreak = 0;
    this.lastDetectAt = timestampMs;

    const all = result?.faceLandmarks || [];
    const blendSets = result?.faceBlendshapes || [];
    const faces = [];
    for (let i = 0; i < all.length; i++) {
      const landmarks = all[i];
      if (!landmarks || landmarks.length < 400) continue;
      let x0 = 1;
      let y0 = 1;
      let x1 = 0;
      let y1 = 0;
      for (const p of landmarks) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      const blendshapes = {};
      const cats = blendSets[i]?.categories;
      if (cats) for (const c of cats) blendshapes[c.categoryName] = c.score;
      faces.push({ landmarks, blendshapes, box: { x0, y0, x1, y1 } });
    }
    return faces;
  }

  close() {
    try {
      this.landmarker?.close?.();
    } catch {
      /* 忽略关闭异常 */
    }
    this.landmarker = null;
  }
}
