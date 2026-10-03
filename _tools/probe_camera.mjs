// 用**真摄像头**（不加 --use-fake-device-for-media-stream）测一遍：
// 设备枚举、权限状态、getUserMedia 具体错误、以及页面自己的诊断结论。
// 只有 --use-fake-ui-for-media-stream（自动点"允许"），所以能区分"权限被拒"和"设备打不开"。
// usage: node probe_camera.mjs <pageUrl> <outDir>   （需要 danger-full-access）
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const PAGE = process.argv[2] || 'http://127.0.0.1:8777/index.html';
const OUT = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_verify\\camera';
const PORT = 9391;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = join(OUT, '_edge-profile-cam');

mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const browser = spawn(
  EDGE,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1000,700',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', // 只自动允许权限，不用假画面
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let version = null;
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) {
      version = await r.json();
      break;
    }
  } catch {}
  await sleep(400);
}
if (!version) throw new Error('devtools 起不来');
console.log('browser:', version.Browser);

let id = 0;
const pending = new Map();
const logs = [];
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send('Page.enable');
await send('Runtime.enable');
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};

// ---- 先做一次纯设备探测（不依赖我的页面）----
await send('Page.navigate', { url: 'about:blank' });
await sleep(600);
const probe = await evaluate(`(async () => {
  const out = { secure: isSecureContext, hasGUM: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
  try {
    const d1 = await navigator.mediaDevices.enumerateDevices();
    out.beforePermission = d1.filter(d => d.kind === 'videoinput').map(d => ({ label: d.label || '(无标签，需授权后才有)', id: d.deviceId.slice(0, 8) }));
  } catch (e) { out.enumErr1 = e.name + ': ' + e.message; }
  try {
    out.perm = (await navigator.permissions.query({ name: 'camera' })).state;
  } catch (e) { out.perm = 'query 不支持: ' + e.message; }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const t = s.getVideoTracks()[0];
    out.gum = { ok: true, label: t.label, settings: t.getSettings() };
    out.tracks = s.getVideoTracks().length;
    await sleep(1200);
    t.stop();
  } catch (e) { out.gum = { ok: false, name: e.name, message: e.message, constraint: e.constraint }; }
  try {
    const d2 = await navigator.mediaDevices.enumerateDevices();
    out.afterPermission = d2.filter(d => d.kind === 'videoinput').map(d => d.label || '(无标签)');
  } catch (e) { out.enumErr2 = e.message; }
  return JSON.stringify(out, null, 1);
})()`);
console.log('=== 设备/权限探测 ===');
console.log(probe);

// ---- 再让我的页面真跑一遍 ----
await send('Page.navigate', { url: PAGE });
await sleep(6000);
const info = await evaluate(`JSON.stringify({
  ready: !!(window.__fm && window.__fm.ready),
  info: window.__fm ? window.__fm.info() : null,
  status: document.getElementById('statusText').textContent,
  sub: document.getElementById('statusSub').textContent,
  hint: document.getElementById('hint').textContent,
})`);
console.log('=== 我的页面结论 ===');
console.log(info);

const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'real-camera.png'), Buffer.from(s.data, 'base64'));
ws.close();
browser.kill();
