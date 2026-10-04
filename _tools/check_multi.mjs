// 核对「多人一起用」：
//   1) 画面里的每一张脸都建出会话、都在线（--expect N 断言至少 N 个人）
//   2) 每个人各自的画风互不干扰（给其中一位换画风，其他人不变）
//   3) 点击画面里的人 → 当前位切换过去
//   4) 截图留证
// usage:
//   node check_multi.mjs <页面URL> <y4m> <outDir> [--expect N]
//   两个人： <y4m=face_two.y4m>   --expect 2
//   很多人： <y4m=face_many.y4m>  --expect 5      （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const PAGE = process.argv[2] || 'file:///D:/桌面/机器人/face-mirror/五官镜像.html';
const Y4M = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_tools\\face_two.y4m';
const OUT = process.argv[4] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\multi';
const EXPECT = Number((process.argv.includes('--expect') ? process.argv[process.argv.indexOf('--expect') + 1] : 2)) || 2;
mkdirSync(OUT, { recursive: true });

const { evaluate, shot, waitFor, close, version, send, logs } = await launch({ port: 9411, outDir: OUT, y4m: Y4M, width: 1280, height: 820 });
console.log('browser:', version.Browser, '| 期望人数 ≥', EXPECT);
await send('Page.navigate', { url: PAGE });
console.log('model ready:', await waitFor('!!(window.__fm && window.__fm.ready)', 60, 500));
await sleep(5000); // 等所有人都稳定

const p1 = JSON.parse(await evaluate('JSON.stringify(window.__fm.people())'));
console.log('画面里的人数 =', p1.onScreen, '| 会话数 =', p1.list.length, '| 当前 =', p1.activeId);
console.log('  明细 →', JSON.stringify(p1.list.map((p) => ({ i: p.index, id: p.id, onScreen: p.onScreen, active: p.active, style: p.style, hit: p.hit }))));
// 先把弹窗关掉，拍一张"每个人各自五官"的干净画面
await evaluate('window.__fm.closeChooser()');
await sleep(400);
await shot(EXPECT > 2 ? '01-很多人同时出现.png' : '01-两个人同时出现.png');
const geo = JSON.parse(await evaluate(`JSON.stringify(window.__fm.people().list.map(p => ({ i: p.index, faceW: p.faceW, center: p.center })))`));
console.log('  几何 →', JSON.stringify(geo));

const steps = [];
const ok1 = p1.onScreen >= EXPECT && p1.list.length >= EXPECT;
steps.push([`画面里同时跟住 ≥${EXPECT} 个人`, ok1]);
// 每个人的五官必须落在自己的脸框里（这条断言抓出过"脸心被镜像两次"的 bug）
const consistent = p1.list.filter((p) => p.onScreen && p.face && p.eyes && p.mouth).every((p) => {
  const f = p.face;
  const inside = (pt) => Math.abs(pt.x - f.cx) < f.w * 0.75 && Math.abs(pt.y - f.cy) < f.h * 0.9;
  return p.eyes.every(inside) && inside(p.mouth);
});
steps.push(['每个人的眼与嘴都在自己的脸框内', consistent]);

// 给"当前这位"换成水墨，另一位应当不变
const onScreen = p1.list.filter((p) => p.onScreen);
const others = onScreen.find((p) => p.id !== p1.activeId);
await evaluate(`window.__fm.setSettings({ style: 'ink' })`);
await sleep(600);
const p2 = JSON.parse(await evaluate('JSON.stringify(window.__fm.people())'));
const act2 = p2.list.find((p) => p.id === p2.activeId);
const oth2 = p2.list.find((p) => p.id === (others ? others.id : -1));
const ok2 = act2 && act2.style === 'ink' && oth2 && oth2.style !== 'ink';
console.log('换画风后 →', JSON.stringify(p2.list.map((p) => ({ i: p.index, style: p.style, active: p.active }))));
steps.push(['每个人的画风互不干扰', !!ok2]);

// 点击另一位（用真实鼠标事件，坐标取他的命中点）
if (others && others.hit) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: others.hit.x, y: others.hit.y, button: 'left', clickCount: 1 });
    await sleep(80);
  }
  await sleep(700);
}
const p3 = JSON.parse(await evaluate('JSON.stringify(window.__fm.people())'));
const switched = others ? p3.activeId === others.id : false;
console.log('点击另一位之后 → 当前 =', p3.activeId, '（期望', others && others.id, '）');
console.log('  明细 →', JSON.stringify(p3.list.map((p) => ({ i: p.index, id: p.id, active: p.active, style: p.style }))));
await evaluate('window.__fm.closeChooser()');
await sleep(400);
await shot('02-点击切换之后.png');
steps.push(['点击切换当前位', switched]);

console.log('\n--- 判定 ---');
let all = true;
for (const [name, ok] of steps) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) all = false;
}
const errs = logs.filter((l) => /EXCEPTION|TypeError/.test(l));
console.log('异常：', errs.length ? errs.slice(0, 3).join(' | ') : '无');
console.log(all ? '\nPASS 多人同框一切正常' : '\nFAIL 多人同框未达预期');
close();
process.exit(all ? 0 : 1);
