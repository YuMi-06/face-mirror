// 复现/回归：**document.baseURI 不能作为基址**的上下文（预览器用 blob:/data: 装载文档时就是这样）
// 做法：往单文件版里插一个 <base href="blob:null/abc">，其余完全不变。
// 修复前：应用脚本在顶层 new URL(...) 抛 "Invalid URL" → 整段程序不执行（用户遇到的就是这个）。
// 修复后：应当正常就绪。
// usage: node check_badbase.mjs   （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || join(ROOT, '五官镜像.html');
const OUT = process.argv[3] || join(ROOT, '_verify');
const TEMP = join(OUT, '_badbase-test.html');
mkdirSync(OUT, { recursive: true });

let html = readFileSync(SRC, 'utf8');
html = html.replace('<head>', '<head>\n<base href="blob:null/abc">');
writeFileSync(TEMP, html);
console.log('已生成带坏 base 的副本：<base href="blob:null/abc">');

const { evaluate, shot, close, version, send, logs } = await launch({ port: 9401, outDir: OUT, width: 1100, height: 800 });
console.log('browser:', version.Browser);
await send('Page.navigate', { url: 'file:///' + TEMP.replace(/\\/g, '/') });

let ready = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  ready = await evaluate('!!(window.__fm && window.__fm.ready)').catch(() => false);
  if (ready) break;
}
const s = JSON.parse(
  await evaluate(`JSON.stringify({
    baseURI: document.baseURI,
    hasFm: typeof window.__fm,
    hasStandalone: !!window.__FM_STANDALONE,
    styleSegChildren: document.getElementById('styleSeg').children.length,
    problemShown: getComputedStyle(document.getElementById('problem')).display !== 'none',
    problemTitle: document.getElementById('problemTitle').textContent,
    problemDetail: document.getElementById('problemDetail').textContent.slice(0, 120),
    status: document.getElementById('statusText').textContent
  })`)
);
await shot('坏base上下文.png');
console.log('表现 →', JSON.stringify(s, null, 1));
const errs = logs.filter((l) => /EXCEPTION|Invalid URL|TypeError/.test(l));
console.log('错误日志 →', errs.slice(0, 3).join(' | ') || '无');

const pass = ready && s.hasFm === 'object';
console.log(pass ? '\nPASS 坏 base 上下文下仍能正常就绪' : '\nFAIL 坏 base 上下文下仍然起不来');
rmSync(TEMP, { force: true });
close();
process.exit(pass ? 0 : 1);
