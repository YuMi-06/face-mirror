// 手机模拟核对：把无头 Edge 伪装成手机（窄屏 + 触摸 + 手机 UA，可选微信/抖音 UA），
// 看页面能不能就绪、有没有脚本报错、面板是否收窄、画风选择是否单列。
// usage: node check_mobile.mjs <页面URL> [y4m] [outDir] [--ua wechat|douyin|plain]
import { launch } from './cdp.mjs';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = process.argv[2] || 'file:///D:/桌面/机器人/face-mirror/五官镜像.html';
const Y4M = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
const OUT = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'D:\\桌面\\机器人\\face-mirror\\_verify\\mobile';
const which = process.argv.includes('--ua') ? process.argv[process.argv.indexOf('--ua') + 1] : 'plain';
mkdirSync(OUT, { recursive: true });

const UA = {
  plain: 'Mozilla/5.0 (Linux; Android 13; SM-S9110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  wechat: 'Mozilla/5.0 (Linux; Android 13; SM-S9110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64',
  douyin: 'Mozilla/5.0 (Linux; Android 13; SM-S9110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 BytedanceWebview/d8a21c6',
}[which] || null;

const { evaluate, shot, waitFor, close, version, send, logs } = await launch({ port: 9423, outDir: OUT, y4m: Y4M, width: 390, height: 844, fakeDevice: true });
console.log('browser:', version.Browser, '| UA 类型:', which);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (UA) await send('Emulation.setUserAgentOverride', { userAgent: UA });
// --block model：拦住模型下载，验证"页面能不能自己说清楚卡在哪"（模拟手机 WebView 拦资源）
if (process.argv.includes('--block')) {
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*face_landmarker.task*'] });
  console.log('已拦截模型下载，用于验证诊断信息');
}
await send('Page.navigate', { url: PAGE });

let ready = false;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  ready = await evaluate('!!window.__fmReady').catch(() => false);
  if (ready) break;
  if (i % 5 === 4) {
    const st = await evaluate('JSON.stringify({L: window.__fmLoading, T: window.__fmTimings})').catch(() => '{}');
    console.log(`  [${i + 1}s]`, st.slice(0, 220));
  }
}
const info = JSON.parse(await evaluate(`JSON.stringify({
  ready: !!window.__fmReady,
  stage: (window.__fmLoading || {}),
  timings: (window.__fmTimings || {}),
  panelCollapsed: document.getElementById('panel').classList.contains('collapsed'),
  panelW: Math.round(document.getElementById('panel').getBoundingClientRect().width),
  viewport: innerWidth + 'x' + innerHeight,
  chooserCols: getComputedStyle(document.querySelector('#chooser .tiles')).gridTemplateColumns,
  problemShown: getComputedStyle(document.getElementById('problem')).display !== 'none',
  problemTitle: document.getElementById('problemTitle').textContent,
  hasRoundRect: typeof CanvasRenderingContext2D.prototype.roundRect === 'function',
  camera: !!window.__fm.info && !!window.__fm.info().cameraError,
})`));
await shot(`手机-${which}.png`);
console.log(JSON.stringify(info, null, 1));

const errs = logs.filter((l) => /EXCEPTION|Uncaught|TypeError:/.test(l) && !/\[camera\]|\[warning\]/.test(l));
const blocked = process.argv.includes('--block');
const detail = await evaluate('document.getElementById("problemDetail").textContent || ""');
const steps = blocked
  ? [
      ['下载被拦时弹出说明面板', info.problemShown === true],
      ['面板里写清了卡在哪一步', /卡在：|阶段 下载/.test(detail)],
      ['里面带上了 UA 与协议（方便截图反馈）', /UA /.test(detail) && /协议 /.test(detail)],
    ]
  : [
      ['页面在手机尺寸下就绪', !!info.ready],
      ['面板在窄屏自动收起', info.panelCollapsed === true],
      ['画风选择改单列', !info.chooserCols.includes(' ') || info.chooserCols.split(' ').length === 1],
      ['没有脚本异常', errs.length === 0],
    ];
if (blocked) console.log('诊断面板正文：\n' + detail);
console.log('\n--- 判定 ---');
let all = true;
for (const [n, ok] of steps) {
  console.log((ok ? 'PASS ' : 'FAIL ') + n);
  if (!ok) all = false;
}
console.log('异常：', errs.length ? errs.slice(0, 3).join(' | ') : '无');
close();
process.exit(all ? 0 : 1);
