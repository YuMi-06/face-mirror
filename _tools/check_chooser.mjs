// 核对「谁坐到摄像头前 → 弹出画风选择」这条交互：
//   1) 假摄像头里出现人脸后，选择应当自动弹出（首次出现）
//   2) 四个格子都在预览（画布非空、各不相同）
//   3) 用真实鼠标点击某个格子 → 画风切换且选择关闭
//   4) 人走开超过阈值再回来 → 当作"又来了一位"，再弹一次
// usage: node check_chooser.mjs <pageUrl> <y4m> <outDir>   （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = process.argv[2] || 'file:///D:/桌面/机器人/face-mirror/五官镜像.html';
const Y4M = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_tools\\face_test.y4m';
const OUT = process.argv[4] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\chooser';
mkdirSync(OUT, { recursive: true });

const { evaluate, shot, waitFor, logs, close, version, send } = await launch({ port: 9395, outDir: OUT, y4m: Y4M, width: 1280, height: 860 });
console.log('browser:', version.Browser);
await send('Page.navigate', { url: PAGE });
console.log('model ready:', await waitFor('!!(window.__fm && window.__fm.ready)'));
await sleep(4500); // 等假摄像头出脸 + 稳定 0.6s

const ui1 = await evaluate('JSON.stringify(window.__fm.chooser())');
console.log('人脸出现后 chooser →', ui1);
await shot('01-自动弹出.png');

// 四个格子是否真的画出了东西，而且互不相同
const tiles = await evaluate(`(function () {
  const out = [];
  for (const t of window.__fm.chooser().tiles) {
    const cv = document.querySelector('#styleTiles button[data-id="' + t.id + '"] canvas');
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let nonEmpty = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4 * 37) { if (d[i + 3] > 0) nonEmpty++; sum += d[i] + d[i + 1] * 3 + d[i + 2] * 7; }
    out.push({ id: t.id, nonEmpty, sig: sum });
  }
  return JSON.stringify(out);
})()`);
console.log('四格预览 →', tiles);

// 真实鼠标点击「像素」那一格
const pick = await evaluate(`(function(){ const t = window.__fm.chooser().tiles.find(t => t.id === 'pixel'); return JSON.stringify(t); })()`);
const rect = JSON.parse(pick);
console.log('点击目标 →', pick);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(70);
}
await sleep(500);
const after = await evaluate('JSON.stringify({ info: window.__fm.info(), chooser: window.__fm.chooser() })');
console.log('点击之后 →', after);
await shot('02-点击像素后.png');

// ---- 第二幕：人走开 6 秒再回来，应当当作"又来了一位"再弹一次 ----
// 用禁用视频轨的方式让画面变黑（检测不到人脸），再打开
await evaluate(`(function(){ const t = document.getElementById('cam').srcObject.getVideoTracks()[0]; t.enabled = false; return true; })()`);
await sleep(6500);
console.log('离开 6.5s 后 →', await evaluate('JSON.stringify({detected: window.__fm.info().detected, chooserOpen: window.__fm.info().chooserOpen})'));
await shot('03-人走开.png');
await evaluate(`(function(){ document.getElementById('cam').srcObject.getVideoTracks()[0].enabled = true; return true; })()`);
await sleep(2500);
const back = await evaluate('JSON.stringify({info: window.__fm.info(), chooser: window.__fm.chooser()})');
console.log('回来之后 →', back);
await shot('04-第二个人再弹.png');

writeFileSync(join(OUT, '_logs.txt'), logs.join('\n'));
const errs = logs.filter((l) => /EXCEPTION|TypeError|不是|NaN/.test(l));
console.log('异常：', errs.length ? errs.slice(0, 4).join(' | ') : '无');
close();
