// 共用的无头 Edge + CDP 脚手架（跑它需要 danger-full-access：本机沙箱会挡 GUI）
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';

export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export async function launch({ port = 9381, outDir, y4m, width = 1280, height = 820, extraArgs = [], fakeDevice = true }) {
  // 每个端口用独立 profile：两次启动不会互抢目录（删不掉会 EPERM）
  const PROFILE = join(outDir, '..', `_edge-profile-${port}`);
  try {
    rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* 上一轮进程还没完全退出时删不掉，换个目录名不影响 */
  }
  mkdirSync(outDir, { recursive: true });

  const args = [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
  ];
  if (fakeDevice) args.push('--use-fake-device-for-media-stream');
  if (y4m) args.push(`--use-file-for-fake-video-capture=${y4m}`);
  args.push(`--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`, 'about:blank', ...extraArgs);

  const browser = spawn(EDGE, args, { stdio: 'ignore', cwd: y4m ? dirname(y4m) : undefined });

  let version = null;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) {
        version = await r.json();
        break;
      }
    } catch {}
    await sleep(400);
  }
  if (!version) throw new Error('devtools 起不来');

  let id = 0;
  const pending = new Map();
  const logs = [];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
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
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[' + m.params.type + '] ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text));
    } else if (m.method === 'Log.entryAdded') {
      logs.push('[log:' + m.params.entry.level + '] ' + m.params.entry.text);
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
  await send('Log.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  const shot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, file), Buffer.from(s.data, 'base64'));
  };

  const waitFor = async (expr, tries = 60, gap = 500) => {
    for (let i = 0; i < tries; i++) {
      const v = await evaluate(expr).catch(() => false);
      if (v) return true;
      await sleep(gap);
    }
    return false;
  };

  return {
    version,
    logs,
    evaluate,
    shot,
    waitFor,
    send,
    close() {
      try {
        ws.close();
      } catch {}
      browser.kill();
    },
  };
}
