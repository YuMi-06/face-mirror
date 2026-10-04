// 核对「定格」与「拍照」：
//   1) 点「定格」→ 姿态冻住（两次采样的 faceW / 眼睛开度完全一样），且 info().frozen = true
//   2) 定格时按 S → 真的下载出一个 PNG（拍照可用）
//   3) 点「继续」→ 姿态重新跟随（两次采样不再相同）
// usage: node check_freeze.mjs <页面URL> <y4m> <outDir>   （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = process.argv[2] || 'file:///D:/桌面/机器人/face-mirror/五官镜像.html';
const Y4M = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_tools\\face_test.y4m';
const OUT = process.argv[4] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\freeze';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const { evaluate, shot, waitFor, close, version, send, logs } = await launch({ port: 9419, outDir: OUT, y4m: Y4M, width: 1100, height: 740 });
console.log('browser:', version.Browser);
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT }).catch(() => {});
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT }).catch(() => {});
await send('Page.navigate', { url: PAGE });
console.log('model ready:', await waitFor('!!(window.__fm && window.__fm.ready)', 60, 500));
await sleep(3500);

const info = async () => JSON.parse(await evaluate('JSON.stringify(window.__fm.info())'));
const btn = async () => JSON.parse(await evaluate(`(() => { const r = document.getElementById('freeze').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: document.getElementById('freeze').textContent }); })()`));
const oneClick = async () => {
  const b = await btn();
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(70);
  }
  await sleep(400);
  return b;
};
/** 无头下"第一次点击"常被吞（窗口刚获得焦点），所以点到状态真的翻转为止 */
const clickUntil = async (want) => {
  for (let i = 0; i < 3; i++) {
    if ((await info()).frozen === want) return true;
    await oneClick();
  }
  return (await info()).frozen === want;
};

await send('Page.bringToFront').catch(() => {});

const steps = [];
const a = await info();
console.log('定格前：faceW =', a.faceW.toFixed(2), ' frozen =', a.frozen, ' 按钮 =', (await btn()).label);

// ---- 1) 定格 ----
const flipped = await clickUntil(true);
const f1 = await info();
await sleep(2500);
const f2 = await info();
const frozenHeld = flipped && f1.frozen === true && Math.abs(f2.faceW - f1.faceW) < 1e-6 && Math.abs(f2.eyeOpenA - f1.eyeOpenA) < 1e-9;
console.log('定格后：faceW', f1.faceW.toFixed(2), '→', f2.faceW.toFixed(2), '| frozen =', f1.frozen, '| 按钮 =', (await btn()).label);
steps.push(['点「定格」后姿态冻住（两次采样完全相同）', frozenHeld]);

// 定格画面截图
await evaluate(`window.__fm.setSettings({ style: 'kawaii' })`);
await sleep(300);
await shot('01-已定格.png');

// ---- 2) 定格时拍照 ----
const pressS = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 's', code: 'KeyS', text: type === 'keyDown' ? 's' : undefined, windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
    await sleep(60);
  }
};
const findShot = () => readdirSync(OUT).filter((n) => /\.png$/i.test(n) && /镜像|\d{8}/.test(n));
let shots = [];
for (let i = 0; i < 3 && shots.length === 0; i++) {
  await pressS();
  await sleep(2200);
  shots = findShot();
}
const shotOk = shots.length > 0 && statSync(`${OUT}\\${shots[0]}`).size > 20000;
console.log('按 S 之后落盘的图：', shots.join(', ') || '（没有）', shotOk ? `${(statSync(`${OUT}\\${shots[0]}`).size / 1024).toFixed(0)} KB` : '');
steps.push(['定格时按 S 真的存出一张 PNG', shotOk]);

// ---- 3) 继续 ----
const resumedClick = await clickUntil(false);
const r1 = await info();
await sleep(2500);
const r2 = await info();
const resumed = resumedClick && r1.frozen === false && Math.abs(r2.faceW - r1.faceW) > 1e-3;
console.log('继续后：faceW', r1.faceW.toFixed(2), '→', r2.faceW.toFixed(2), '| frozen =', r1.frozen, '| 按钮 =', (await btn()).label);
steps.push(['点「继续」后重新跟随（数值开始变化）', resumed]);

console.log('\n--- 判定 ---');
let all = true;
for (const [name, ok] of steps) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) all = false;
}
const errs = logs.filter((l) => /EXCEPTION|TypeError/.test(l));
console.log('异常：', errs.length ? errs.slice(0, 3).join(' | ') : '无');
console.log(all ? '\nPASS 定格与拍照都正常' : '\nFAIL 定格/拍照未达预期');
close();
process.exit(all ? 0 : 1);
