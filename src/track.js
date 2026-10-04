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

/** 当前浏览器能不能编译 WebAssembly SIMD —— MediaPipe 有 SIMD / 非 SIMD 两份 wasm，选错就起不来 */
function supportsSimd() {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
    );
  } catch {
    return false;
  }
}

/** 把"当前卡在哪一步"写到页面上（手机上没控制台，只能靠它） */
function stage(name, note) {
  globalThis.__fmLoading = { ...(globalThis.__fmLoading || {}), stage: name, note: note || '' };
  try {
    globalThis.__fmStageHook && globalThis.__fmStageHook(globalThis.__fmLoading);
  } catch {
    /* 忽略 */
  }
}

/**
 * 自己下载（带进度）。
 * 不用 MediaPipe 内部的加载：它把"脚本 → wasm → 模型"三步藏在里面，任何一步慢或被拦，
 * 外面只看到"一直在载入"，不知道卡在哪。自己下还能单独重试、报准确的 HTTP 状态。
 */
async function fetchBytes(url, key, label) {
  const t0 = performance.now();
  stage('下载', `正在下载${label}…`);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`${label}下载失败（网络被拦？）：${(e && e.message) || e}`);
  }
  if (!res.ok) throw new Error(`${label}下载失败：HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let bytes;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      // 注意：GitHub Pages 对 wasm 会 gzip，content-length 是**压缩后**的大小，
      // 而我们数的是解压后的字节 → 出现 "9.1 / 2.9 MB" 这种怪数字。读超了就只显示已下载量。
      const shownTotal = total && got <= total ? total : 0;
      globalThis.__fmLoading = { ...(globalThis.__fmLoading || {}), stage: '下载', note: `正在下载${label}…`, key, got, total: shownTotal };
      try {
        globalThis.__fmStageHook && globalThis.__fmStageHook(globalThis.__fmLoading);
      } catch {
        /* 忽略 */
      }
    }
    bytes = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const T = (globalThis.__fmTimings = globalThis.__fmTimings || {});
  T[key + 'Ms'] = Math.round(performance.now() - t0);
  T[key + 'Bytes'] = bytes.length;
  return bytes;
}

/** 加载普通 <script>（**不带 crossorigin**：file:// 与部分手机 WebView 下带 crossorigin 会被拦） */
function loadClassicScript(url, label) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.onload = () => res();
    s.onerror = () => rej(new Error(`${label}加载失败：${url}`));
    document.head.appendChild(s);
  });
}

/** 给"建任务"加超时：手机上申请不到 GPU 上下文时会**一直等**，不报错也不返回 */
function withTimeout(promise, ms, what) {
  let timer = 0;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`${what}（等了 ${Math.round(ms / 1000)} 秒）`)), ms);
    }),
  ]);
}

export class FaceTracker {  constructor() {
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
      // 源码 / 本机服务模式：**自己下载 wasm 与模型**，再用和单文件版完全相同的方式交给 MediaPipe
      // （wasmLoaderPath='' + Module.wasmBinary + modelAssetBuffer）。
      // 为什么不用 MediaPipe 自己的加载：
      //   ① 它内部是"先加载胶水脚本、再 fetch wasm、再 fetch 模型"，手机上任何一步慢/被拦，
      //      外面只看到"一直在载入"，**不知道卡在哪**（用户就是在抖音内置浏览器里卡住的）；
      //   ② 自己下载能显示进度、能单独重试、能给出准确的 HTTP 错误。
      const simd = supportsSimd();
      T.simd = simd;
      const glueName = simd ? 'vision_wasm_internal.js' : 'vision_wasm_nosimd_internal.js';
      const wasmName = simd ? 'vision_wasm_internal.wasm' : 'vision_wasm_nosimd_internal.wasm';
      T.glueName = glueName;
      stage('胶水层', '正在加载运行时（' + (simd ? 'SIMD' : '非 SIMD') + '）…');
      await loadClassicScript(vendorUrl('vendor/mediapipe/wasm/' + glueName), '运行时胶水层');
      if (typeof globalThis.ModuleFactory !== 'function') {
        throw new Error('胶水层加载了但 window.ModuleFactory 没出现：' + glueName);
      }
      const wasmBytes = await fetchBytes(vendorUrl('vendor/mediapipe/wasm/' + wasmName), 'wasm', '人脸模型运行时');
      const modelBytes = await fetchBytes(vendorUrl('vendor/models/face_landmarker.task'), 'model', '人脸模型');
      globalThis.Module = { wasmBinary: wasmBytes };
      this.filesetOverride = { wasmLoaderPath: '', wasmBinaryPath: '' };
      baseOptions = { modelAssetBuffer: modelBytes, delegate: 'GPU' };
      this.wasmDir = 'vendor/mediapipe/wasm';
    }
    T.decodeEnd = performance.now();

    T.filesetStart = performance.now();
    const fileset = await FilesetResolver.forVisionTasks(this.wasmDir || STANDALONE_AT_LOAD?.wasmDir || 'vendor/mediapipe/wasm');
    if (this.filesetOverride) Object.assign(fileset, this.filesetOverride);
    T.filesetEnd = performance.now();

    // 先试 GPU；不支持、报错、或**卡住超过 20 秒**（手机 WebView 上 GPU 上下文申请不到时会一直等）
    // 都退回 CPU —— 慢一点，但一定能跑。
    T.createStart = performance.now();
    stage('建任务', '正在初始化人脸模型（GPU）…');
    try {
      this.landmarker = await withTimeout(
        FaceLandmarker.createFromOptions(fileset, { ...OPTIONS, baseOptions }),
        20000,
        'GPU 初始化超时'
      );
      this.delegate = 'GPU';
    } catch (gpuErr) {
      console.warn('[track] GPU 委托不可用，退回 CPU：', gpuErr);
      stage('建任务', 'GPU 不行，改用 CPU…');
      this.landmarker = await withTimeout(
        FaceLandmarker.createFromOptions(fileset, { ...OPTIONS, baseOptions: { ...baseOptions, delegate: 'CPU' } }),
        30000,
        'CPU 初始化超时'
      );
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
