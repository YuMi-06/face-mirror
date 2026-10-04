// 核对「眼睛倾斜角」这个坑：
//   真摄像头链路下，水平正对镜头时两只眼的 tilt 必须接近 0（修之前是 ±π，
//   于是每只眼被旋转 180°——睫毛跑到内眼角、瞳孔方向反、闭眼尖括号 `> <` 左右颠倒）。
//   然后强制闭眼拍一张，确认左眼是 `>`、右眼是 `<`。
// usage: node check_eye_tilt.mjs <页面URL> <y4m> <outDir>   （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = process.argv[2] || 'file:///D:/桌面/机器人/face-mirror/五官镜像.html';
const Y4M = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_tools\\face_test.y4m';
const OUT = process.argv[4] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\tilt';
mkdirSync(OUT, { recursive: true });

const FACE = 'face:{cx:0.5,cy:0.46,w:0.42,h:0.56},brows:[{y:0.30,lift:0.1},{y:0.30,lift:0.1}],nose:{x:0.5,y:0.47},mouth:{x:0.5,y:0.62,w:0.16,open:0.15,curve:0.3}';

const { evaluate, shot, waitFor, close, version, send, logs } = await launch({ port: 9421, outDir: OUT, y4m: Y4M, width: 1000, height: 700 });
console.log('browser:', version.Browser);
await send('Page.navigate', { url: PAGE });
await waitFor('!!(window.__fm && window.__fm.ready)', 60, 500);
await evaluate('window.__fm.setSettings({view:"off", zoom:1.35, autoPrompt:false})');
await sleep(4000); // 让脸稳定

const people = JSON.parse(await evaluate('JSON.stringify(window.__fm.people())'));
const person = people.list.find((p) => p.onScreen) || people.list[0];
const tilts = (person.eyes || []).map((e) => e.tilt);
const maxAbs = Math.max(...tilts.map(Math.abs));
console.log('真实链路两眼 tilt =', tilts.join(' / '), ' | 最大绝对值 =', maxAbs.toFixed(3), 'rad（', ((maxAbs * 180) / Math.PI).toFixed(1), '° ）');
const tiltOk = tilts.length === 2 && maxAbs < 0.35;
console.log(tiltOk ? '→ 眼睛没有被旋转 180°' : '→ 仍然接近 π：眼睛被整体翻过来了');

// 强制闭眼（tilt 取 0，模拟水平正对），确认尖括号左右方向
for (const style of ['kawaii', 'pixel', 'ink', 'abstract']) {
  await evaluate(`window.__fm.setSettings({style:'${style}'}); window.__fm.setOverride({sleepy:0,mood:{sleepy:0},${FACE},eyes:[{open:0.02},{open:0.02}]});`);
  await sleep(320);
  await shot(`闭眼-${style}.png`);
}

const steps = [
  ['两眼 tilt 接近 0（不再被翻 180°）', tiltOk],
];
console.log('\n--- 判定 ---');
let all = true;
for (const [name, ok] of steps) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) all = false;
}
const errs = logs.filter((l) => /EXCEPTION|TypeError/.test(l));
console.log('异常：', errs.length ? errs.slice(0, 3).join(' | ') : '无');
close();
process.exit(all ? 0 : 1);
