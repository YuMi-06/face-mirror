// 核对「闭眼 = 眨个眼（wink）」：
//   A) 两眼都闭（眨眼）→ 应画成两道上拱 + 睫毛
//   B) 只闭一只（真的 wink）→ 闭的那只加一颗小星，另一只照常睁着
//   C) 睡着状态（没人在画面里）→ 仍然是老实的一条横线（跟眨眼区分）
// 四个画风各拍一组。
// usage: node check_wink.mjs <页面URL> <outDir>   （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const PAGE = process.argv[2] || 'file:///D:/桌面/机器人/face-mirror/五官镜像.html';
const OUT = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\wink';
mkdirSync(OUT, { recursive: true });

const FACE = 'face:{cx:0.5,cy:0.46,w:0.42,h:0.56},brows:[{y:0.30,lift:0.1},{y:0.30,lift:0.1}],nose:{x:0.5,y:0.47},mouth:{x:0.5,y:0.62,w:0.16,open:0.15,curve:0.3}';
const POSES = {
  '两眼都闭（眨眼）': `sleepy:0,mood:{sleepy:0},${FACE},eyes:[{open:0.02},{open:0.02}]`,
  '只闭左眼（wink）': `sleepy:0,mood:{sleepy:0},${FACE},eyes:[{open:0.02},{open:1.0}]`,
  '睡着（没人在画面）': `sleepy:1,mood:{sleepy:1},${FACE},eyes:[{open:0.02},{open:0.02}]`,
};
const STYLES = ['kawaii', 'abstract', 'pixel', 'ink'];

const { evaluate, shot, waitFor, close, version, send, logs } = await launch({ port: 9417, outDir: OUT, width: 900, height: 620 });
console.log('browser:', version.Browser);
await send('Page.navigate', { url: PAGE });
await waitFor('!!(window.__fm && window.__fm.ready)', 60, 500);
await evaluate(`window.__fm.setSettings({view:'off', zoom:1.5, autoPrompt:false})`);
await sleep(600);

for (const [poseName, pose] of Object.entries(POSES)) {
  for (const style of STYLES) {
    await evaluate(`window.__fm.setSettings({style:'${style}'}); window.__fm.setOverride({${pose}});`);
    await sleep(320);
    await shot(`${poseName}-${style}.png`);
  }
  console.log('拍完：', poseName);
}
const errs = logs.filter((l) => /EXCEPTION|TypeError|Error:/.test(l));
console.log('异常：', errs.length ? errs.slice(0, 3).join(' | ') : '无');
console.log('图在', OUT);
close();
