// 启动状态核对：
//  1) file:// 打开时必须给出「请用 bat 启动」的友好提示，而不是白屏；
//  2) http 正常打开时 boot / fatal 覆盖层必须真的 hidden（作者样式别把 [hidden] 盖掉）。
// usage: node check_boot.mjs <httpUrl> <fileUrl> <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync } from 'node:fs';

const HTTP = process.argv[2] || 'http://127.0.0.1:8778/index.html';
const FILE = process.argv[3] || 'file:///D:/桌面/机器人/face-mirror/index.html';
const OUT = process.argv[4] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\boot';
mkdirSync(OUT, { recursive: true });

const { evaluate, shot, waitFor, close, version, send } = await launch({ port: 9385, outDir: OUT, width: 1000, height: 700 });
console.log('browser:', version.Browser);

const state = () =>
  evaluate(`JSON.stringify({
    fileWarn: getComputedStyle(document.getElementById('filewarn')).display !== 'none',
    boot: getComputedStyle(document.getElementById('boot')).display !== 'none',
    fatal: getComputedStyle(document.getElementById('fatal')).display !== 'none',
    fatalText: document.getElementById('fatalMsg').textContent,
    status: document.getElementById('statusText').textContent,
    sub: document.getElementById('statusSub').textContent,
    hasFm: !!window.__fm
  })`);

await send('Page.navigate', { url: FILE });
await new Promise((r) => setTimeout(r, 2500));
await shot('file-protocol.png');
console.log('file:// →', await state());

await send('Page.navigate', { url: HTTP });
const ready = await waitFor('!!(window.__fm && window.__fm.ready)');
await new Promise((r) => setTimeout(r, 1500));
await shot('http-boot.png');
console.log('http ready:', ready, '→', await state());

close();
