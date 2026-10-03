// 插桩实验：单文件版在运行期到底有没有创建 <script src>？
//   - 有 → 说明还在走 MediaPipe 的脚本加载（我这边还有 bug）
//   - 没有 → 说明用户那次报错来自**旧的构建**（页面上现在显示构建号，可据此确认）
// usage: node probe_scripts.mjs [--csp]    （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_verify');
const withCsp = process.argv.includes('--csp');

let url = 'file:///' + join(ROOT, '五官镜像.html').replace(/\\/g, '/');
if (withCsp) {
  const CSP = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob: mediastream:";
  const tmp = join(OUT, '_probe-csp.html');
  writeFileSync(tmp, readFileSync(join(ROOT, '五官镜像.html'), 'utf8').replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  url = 'file:///' + tmp.replace(/\\/g, '/');
}

const { evaluate, close, version, send, shot } = await launch({ port: 9407, outDir: OUT, width: 1000, height: 760 });
console.log('browser:', version.Browser, '| CSP:', withCsp ? '严格' : '无');

// 在页面任何脚本之前插桩：记录所有被插入 DOM 的 <script> 与它们的 src
const INSTRUMENT = `(() => {
  window.__scripts = [];
  window.__errors = [];
  const note = (el) => { try { if (el && el.tagName === 'SCRIPT') window.__scripts.push(el.src ? String(el.src).slice(0, 70) : '(inline)'); } catch (e) {} };
  const ap = Node.prototype.appendChild;
  Node.prototype.appendChild = function (n) { note(n); return ap.call(this, n); };
  const ib = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (n, r) { note(n); return ib.call(this, n, r); };
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (k, v) {
    if (this.tagName === 'SCRIPT' && String(k).toLowerCase() === 'src') { try { window.__scripts.push('setAttribute: ' + String(v).slice(0, 70)); } catch (e) {} }
    return sa.call(this, k, v);
  };
  addEventListener('error', (e) => { try { window.__errors.push(String((e && (e.message || (e.target && e.target.tagName))) || 'event')); } catch (x) {} }, true);
})();`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });
await send('Page.navigate', { url });

let ready = false;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  ready = await evaluate('!!(window.__fm && window.__fm.ready)').catch(() => false);
  if (ready) break;
}
const s = JSON.parse(
  await evaluate(`JSON.stringify({
    build: window.__FM_BUILD || '(源码版)',
    ready: !!window.__fmReady,
    scripts: window.__scripts,
    errors: window.__errors.slice(0, 5),
    status: document.getElementById('statusText').textContent,
    problemShown: getComputedStyle(document.getElementById('problem')).display !== 'none',
    problemTitle: document.getElementById('problemTitle').textContent
  })`)
);
await shot(withCsp ? '插桩-严格CSP.png' : '插桩-普通.png');
console.log(JSON.stringify(s, null, 1));
console.log(s.scripts.length === 0 ? '\n结论：运行期没有创建任何 <script src>（当前构建不走脚本加载）' : '\n结论：仍然创建了脚本元素 → 见上面的列表');
rmSync(join(OUT, '_probe-csp.html'), { force: true });
close();
