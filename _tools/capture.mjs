// 无头 Edge + CDP 核对 face-mirror:
//   1) 用 --use-file-for-fake-video-capture 把真人脸 y4m 当摄像头喂进去，验证整条真实链路；
//   2) 用 __fm.setOverride() 注入归一化五官姿态，逐个画风核对五官形状。
// usage: node capture.mjs <url> <y4m> <outDir>    （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = process.argv[2] || 'http://127.0.0.1:8778/index.html';
const Y4M = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_tools\\face_test.y4m';
const OUT = process.argv[4] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\shots';

const { evaluate, shot, waitFor, logs, close, version, send } = await launch({ port: 9381, outDir: OUT, y4m: Y4M });
console.log('browser:', version.Browser);

await send('Page.navigate', { url: PAGE });
const ready = await waitFor('!!(window.__fm && window.__fm.ready)');
console.log('model ready:', ready);
if (!ready) {
  console.log('fatal:', await evaluate("document.getElementById('fatalMsg').textContent").catch(() => '?'));
  console.log(logs.join('\n'));
  close();
  process.exit(2);
}

const report = [];
async function grab(name, setup) {
  if (setup) {
    try {
      await evaluate(`(function(){ ${setup} })()`);
    } catch (e) {
      console.log('SETUP ERROR', name, e.message);
    }
  }
  await sleep(340);
  await shot(name);
  let info = null;
  try {
    info = await evaluate('JSON.stringify(window.__fm.info())');
  } catch {}
  report.push({ name, info });
  console.log('saved', name, info);
}

// ---------- 1. 真实链路（y4m 假摄像头） ----------
await sleep(3500);
await sleep(500);
await grab('00-真实-默认.png', "window.__fm.clearOverride(); window.__fm.setSettings({style:'kawaii',palette:'peach',view:'pip'});");
await grab('01-真实-调试.png', "window.__fm.setSettings({view:'debug',zoom:1.0});");
await grab('02-真实-抽象.png', "window.__fm.setSettings({style:'abstract',view:'off'});");
await grab('03-真实-像素.png', "window.__fm.setSettings({style:'pixel',palette:'galaxy',view:'off'});");
await grab('04-真实-水墨.png', "window.__fm.setSettings({style:'ink',palette:'ink',view:'off'});");

// ---------- 2. 注入姿态核对形状 ----------
// 布局按 1250x725 画布标定（M ≈ H），比例取自实测的人脸几何，保证五官解剖关系合理
const LAY = { cx: 0.52, eyeY: 0.425, browY: 0.299, noseY: 0.575, mouthY: 0.66, eyeDX: 0.039, eyeW: 0.057, browW: 0.068, noseW: 0.068, mouthW: 0.14 };
function pose(p = {}) {
  const d = {
    openA: 0.92, openB: 0.92, wideA: 0, wideB: 0, joyA: 0, joyB: 0, gazeA: '', gazeB: '',
    raiseA: 0.05, raiseB: 0.05, innerA: 0, innerB: 0, downA: 0, downB: 0,
    mouthOpen: 0, smile: 0.12, frown: 0, pucker: 0, tongue: 0, blush: 0, puff: 0, joy: 0, surprise: 0, sleepy: 0,
    ...p,
  };
  const eye = (x, o, w, j, gz) => `{x:${x},y:${LAY.eyeY},w:${LAY.eyeW},open:${o},wide:${w},joy:${j}${gz}}`;
  const brow = (x, r, i, dn) => `{x:${x},y:${LAY.browY},w:${LAY.browW},raise:${r},innerUp:${i},down:${dn}}`;
  return `face:{cx:${LAY.cx},cy:0.5,w:0.31,h:0.34},
    eyes:[${eye(LAY.cx - LAY.eyeDX, d.openA, d.wideA, d.joyA, d.gazeA)},${eye(LAY.cx + LAY.eyeDX, d.openB, d.wideB, d.joyB, d.gazeB)}],
    brows:[${brow(LAY.cx - LAY.eyeDX, d.raiseA, d.innerA, d.downA)},${brow(LAY.cx + LAY.eyeDX, d.raiseB, d.innerB, d.downB)}],
    nose:{x:${LAY.cx},y:${LAY.noseY},w:${LAY.noseW}},
    mouth:{x:${LAY.cx},y:${LAY.mouthY},w:${LAY.mouthW},open:${d.mouthOpen},smile:${d.smile},frown:${d.frown},pucker:${d.pucker},tongue:${d.tongue}},
    cheek:{blush:${d.blush},puff:${d.puff}},mood:{joy:${d.joy},surprise:${d.surprise},sleepy:${d.sleepy}}`;
}
const GAZE = ',gazeX:-0.95,gazeY:-0.6';
const POSES = {
  neutral: pose(),
  smile: pose({ openA: 0.78, openB: 0.78, joyA: 0.5, joyB: 0.5, raiseA: 0.55, raiseB: 0.55, mouthOpen: 0.12, smile: 1, blush: 1, joy: 0.9 }),
  open_mouth: pose({ openA: 0.98, openB: 0.98, wideA: 0.7, wideB: 0.7, raiseA: 1.2, raiseB: 1.2, mouthOpen: 0.85, surprise: 1, blush: 0.35 }),
  tongue: pose({ openA: 0.8, openB: 0.8, joyA: 0.6, joyB: 0.6, mouthOpen: 0.4, tongue: 1, smile: 0.6, blush: 0.9 }),
  blink: pose({ openA: 0.02, openB: 0.02, raiseA: 0.1, raiseB: 0.1, smile: 0.25 }),
  wink: pose({ openA: 0.02, openB: 0.95, raiseA: -0.2, raiseB: 0.7, mouthOpen: 0.15, smile: 0.8, blush: 0.7 }),
  frown: pose({ openA: 0.72, openB: 0.72, raiseA: -0.7, raiseB: -0.7, downA: 0.9, downB: 0.9, frown: 0.95 }),
  gaze: pose({ openA: 0.9, openB: 0.9, gazeA: GAZE, gazeB: GAZE, raiseA: 0.2, raiseB: 0.2, smile: 0.2 }),
  pucker: pose({ openA: 0.85, openB: 0.85, raiseA: 0.3, raiseB: 0.3, innerA: 0.4, innerB: 0.4, mouthOpen: 0.05, pucker: 0.95 }),
  sleep: pose({ openA: 0.03, openB: 0.03, raiseA: -0.45, raiseB: -0.45, innerA: 0.35, innerB: 0.35, mouthOpen: 0.08, sleepy: 1 }),
};

const matrix = [
  ['kawaii', 'peach', 'neutral'],
  ['kawaii', 'peach', 'smile'],
  ['kawaii', 'peach', 'open_mouth'],
  ['kawaii', 'candy', 'tongue'],
  ['kawaii', 'mint', 'blink'],
  ['kawaii', 'peach', 'wink'],
  ['abstract', 'peach', 'neutral'],
  ['abstract', 'mint', 'smile'],
  ['abstract', 'galaxy', 'open_mouth'],
  ['abstract', 'candy', 'frown'],
  ['abstract', 'peach', 'gaze'],
  ['pixel', 'galaxy', 'neutral'],
  ['pixel', 'galaxy', 'smile'],
  ['pixel', 'galaxy', 'open_mouth'],
  ['pixel', 'galaxy', 'blink'],
  ['ink', 'ink', 'neutral'],
  ['ink', 'ink', 'smile'],
  ['ink', 'ink', 'open_mouth'],
  ['ink', 'ink', 'gaze'],
  ['ink', 'ink', 'pucker'],
  ['ink', 'ink', 'sleep'],
];
let n = 10;
for (const [style, palette, pose] of matrix) {
  await grab(
    `${String(n).padStart(2, '0')}-${style}-${palette}-${pose}.png`,
    `window.__fm.setSettings({style:'${style}',palette:'${palette}',view:'off',zoom:1.35}); window.__fm.setOverride({${POSES[pose]}});`
  );
  n += 1;
}

writeFileSync(join(OUT, '_report.json'), JSON.stringify({ report, logs }, null, 1));
console.log('--- console ---');
console.log(logs.filter((l) => !/GL Driver|gl_context|Graph successfully/.test(l)).slice(0, 40).join('\n'));
close();
console.log('done');
