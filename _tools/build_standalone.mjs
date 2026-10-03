// 生成单文件版「五官镜像.html」：
//   - 把打包后的应用、wasm 二进制（data: URL）、人脸模型（base64 → Uint8Array）全部内联
//   - 于是双击即可用，不需要启动器、不需要本机服务、没有黑窗口
//   - 仍然需要同目录下的 vendor/mediapipe/wasm/*.js（胶水层走 <script src>，file:// 允许）
// usage: node _tools/build_standalone.mjs [--quiet]
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bundle, ROOT } from './bundle.mjs';

const quiet = process.argv.includes('--quiet');
const wasmPath = join(ROOT, 'vendor', 'mediapipe', 'wasm', 'vision_wasm_internal.wasm');
const gluePath = join(ROOT, 'vendor', 'mediapipe', 'wasm', 'vision_wasm_internal.js');
const modelPath = join(ROOT, 'vendor', 'models', 'face_landmarker.task');

const wasm = readFileSync(wasmPath);
const glueSrc = readFileSync(gluePath, 'utf8');
const model = readFileSync(modelPath);
const wasmB64 = wasm.toString('base64');
const modelB64 = model.toString('base64');
const { code: appCode, modules } = bundle('src/main.js');

// 构建编号写进页面上（面板里能看到）：一眼分辨"你打开的是哪一版"
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const BUILD_ID = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const TAG = '<script type="module" src="./src/main.js"></script>';
if (!html.includes(TAG)) throw new Error('index.html 里找不到模块入口标签，模板变了？');

// 顺序很重要：**应用脚本在前，17 MB 的内联资源在后**。
// 这样万一文档被截断（尾部丢掉），丢的是资源而不是程序本身 ——
// 界面照样出来，并且会明确报"内联资源没加载到"，而不是黑屏卡住。
//
// 胶水层（MediaPipe 的 wasm 装载器）直接内联成**普通 <script>**：
// MediaPipe 原本是用 <script src="..."> 加载它的，而预览面板的 CSP 通常只允许内联脚本
// （data:/blob: 脚本会被拦掉，报出来就是 [object Event]）。内联后配合
// wasmLoaderPath = ''（MediaPipe 会跳过脚本加载），整个应用**不需要任何 URL 加载**：
// 应用代码内联、胶水层内联、wasm 在内存、模型在内存 —— 再严的 CSP 也拦不到。
for (const [name, code] of [['胶水层', glueSrc], ['应用代码', appCode]]) {
  if (/<\/script/i.test(code) || /<!--/.test(code)) throw new Error(name + ' 里出现了会破坏 HTML 的片段，需要转义');
}
const payload = `<script>
${appCode}
</script>
<script>
${glueSrc}
</script>
<script>
/* 单文件版内联资源：file:// 下取不到任何本地文件，所以 wasm 与模型也都内联。
   两者只存 base64 原文，解码交给应用（自己解码比走 data: URL 往返更快、也不吃 CSP）。 */
window.__FM_BUILD = '${BUILD_ID}';
window.__FM_STANDALONE = {
  wasmB64: '${wasmB64}',
  modelB64: '${modelB64}'
};
window.__fmPayloadAt = performance.now();
</script>`;

html = html.replace(TAG, payload);
const out = join(ROOT, '五官镜像.html');
writeFileSync(out, html, 'utf8');

if (!quiet) {
  console.log('模块：', modules.length, '个 →', modules.join(', '));
  console.log('内联 胶水:', (glueSrc.length / 1024).toFixed(0), 'KB（普通 <script>，不走 URL）');
  console.log('内联 wasm :', (wasm.length / 1048576).toFixed(2), 'MB →', (wasmB64.length / 1048576).toFixed(2), 'MB base64');
  console.log('内联 模型 :', (model.length / 1048576).toFixed(2), 'MB →', (modelB64.length / 1048576).toFixed(2), 'MB base64');
  console.log('应用代码  :', (appCode.length / 1024).toFixed(0), 'KB');
  console.log('产出      :', out, (statSync(out).size / 1048576).toFixed(2), 'MB');
  const check = readFileSync(out, 'utf8');
  console.log('自检：仍含 module 标签?', check.includes(TAG), ' 含 __FM_STANDALONE?', check.includes('__FM_STANDALONE'),
    ' 还引用 vendor 路径?', /src="\.\/vendor/.test(check));
}
