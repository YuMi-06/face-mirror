// 回归：预览面板那种"严格 CSP"下必须给出正确结果。
// 起因：用户的预览面板把文档塞进 blob: 里渲染，并下了 `script-src 'unsafe-inline'`：
//   ① 第一轮：data: 脚本被拦 → 胶水层加载失败（[object Event]）→ 已改成内联 <script>；
//   ② 第二轮：连 WebAssembly 编译都被拦（CSP 缺 wasm-unsafe-eval）→ 这是环境限制，
//      页面必须**当场说清楚**"请用 Edge 打开"，而不是丢一句"模型载入失败"。
// 所以本脚本跑两种 CSP：
//   A. 允许 wasm（补上 wasm-unsafe-eval）→ 必须能正常就绪；
//   B. 不允许 wasm（只有 unsafe-inline）→ 必须弹出"这个窗口跑不了这个页面"。
// usage: node check_csp.mjs   （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || join(ROOT, '五官镜像.html');
const OUT = process.argv[3] || join(ROOT, '_verify');
mkdirSync(OUT, { recursive: true });

const CASES = [
  {
    name: 'A. 允许 wasm 的 CSP',
    csp: "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob: mediastream:",
    expectReady: true,
  },
  {
    name: 'B. 不允许 wasm 的 CSP（用户那种）',
    csp: "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob: mediastream:",
    expectReady: false,
  },
];

const base = readFileSync(SRC, 'utf8');
let allPass = true;

for (const [idx, c] of CASES.entries()) {
  const TEMP = join(OUT, `_csp-test-${idx}.html`);
  writeFileSync(TEMP, base.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${c.csp}">`));

  const { evaluate, shot, close, version, send, logs } = await launch({ port: 9403 + idx, outDir: OUT, width: 1100, height: 800 });
  await send('Page.navigate', { url: 'file:///' + TEMP.replace(/\\/g, '/') });

  let ready = false;
  for (let i = 0; i < 24; i++) {
    await sleep(500);
    ready = await evaluate('!!(window.__fm && window.__fm.ready)').catch(() => false);
    if (ready) break;
  }
  const s = JSON.parse(
    await evaluate(`JSON.stringify({
      hasModuleFactory: typeof window.ModuleFactory,
      styleSegChildren: document.getElementById('styleSeg').children.length,
      problemShown: getComputedStyle(document.getElementById('problem')).display !== 'none',
      problemTitle: document.getElementById('problemTitle').textContent,
      problemMsg: document.getElementById('problemMsg').textContent.slice(0, 80),
      status: document.getElementById('statusText').textContent
    })`)
  );
  await shot(`严格CSP-${idx === 0 ? '允许wasm' : '禁止wasm'}.png`);

  let pass;
  if (c.expectReady) {
    // 注意：MediaPipe 载入完成后会主动清空 self.ModuleFactory，所以这里不能拿它当判据
    pass = ready && s.styleSegChildren > 0 && !s.problemShown;
    console.log(`${c.name} → ready=${ready} 界面元素=${s.styleSegChildren} 状态="${s.status}"  ${pass ? 'PASS' : 'FAIL'}`);
  } else {
    // 必须：界面正常建起来 + 明确说明"这个窗口跑不了"
    pass = s.styleSegChildren > 0 && s.problemShown && s.problemTitle.includes('跑不了');
    console.log(`${c.name} → 界面元素=${s.styleSegChildren} 提示="${s.problemTitle} / ${s.problemMsg}"  ${pass ? 'PASS' : 'FAIL'}`);
  }
  if (!pass) {
    allPass = false;
    console.log('  详情 →', JSON.stringify(s));
    console.log('  日志 →', logs.filter((l) => /CSP|Refused|Error/i.test(l)).slice(0, 2).join(' | '));
  }
  rmSync(TEMP, { force: true });
  close();
}

console.log(allPass ? '\nPASS 两种 CSP 下的行为都正确' : '\nFAIL 严格 CSP 场景未达预期');
process.exit(allPass ? 0 : 1);
