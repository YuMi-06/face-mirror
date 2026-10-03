// 把 MediaPipe tasks-vision 运行时与人脸关键点模型抓到本地 vendor/，之后页面完全离线。
// 用法: node _tools/fetch_vendor.mjs [--force]
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.10.20';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const TARGETS = [
  [`${CDN}/vision_bundle.mjs`, 'vendor/mediapipe/vision_bundle.mjs'],
  [`${CDN}/wasm/vision_wasm_internal.js`, 'vendor/mediapipe/wasm/vision_wasm_internal.js'],
  [`${CDN}/wasm/vision_wasm_internal.wasm`, 'vendor/mediapipe/wasm/vision_wasm_internal.wasm'],
  [`${CDN}/wasm/vision_wasm_nosimd_internal.js`, 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js'],
  [`${CDN}/wasm/vision_wasm_nosimd_internal.wasm`, 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm'],
  [MODEL, 'vendor/models/face_landmarker.task'],
];

const force = process.argv.includes('--force');

async function exists(p) {
  try { const s = await stat(p); return s.size > 0; } catch { return false; }
}

let failed = 0;
for (const [url, rel] of TARGETS) {
  const out = join(ROOT, rel);
  if (!force && await exists(out)) { console.log(`skip   ${rel}`); continue; }
  await mkdir(dirname(out), { recursive: true });
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(out, buf);
    console.log(`ok     ${rel}  ${(buf.length / 1048576).toFixed(2)} MB`);
  } catch (err) {
    failed++;
    console.log(`FAIL   ${rel}  ${err.message}`);
  }
}
console.log(failed ? `\n${failed} 个文件失败` : '\nvendor 就绪');
process.exit(failed ? 1 : 0);
