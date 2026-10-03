// 回归自检：**故意把单文件版截断**，确认页面不会黑屏卡死，而是自己把原因说清楚。
// 起因：用户用"文件预览面板"打开时文档没装载完整，最后那段应用脚本没执行 → 黑屏 + 停在
//      "正在载入人脸模型…"，页面一句话都不说。现在应用脚本排在资源前面，且带自诊断。
// usage: node check_truncated.mjs [源文件] [outDir]   （需要 danger-full-access）
import { launch } from './cdp.mjs';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || join(ROOT, '五官镜像.html');
const OUT = process.argv[3] || join(ROOT, '_verify');
const CUT_BYTES = 200000; // 砍掉尾部 200 KB（正好落在内联资源脚本里）
const TEMP = join(OUT, '_truncated-test.html');

mkdirSync(OUT, { recursive: true });
const buf = readFileSync(SRC);
writeFileSync(TEMP, buf.subarray(0, buf.length - CUT_BYTES));
console.log(`源文件 ${(buf.length / 1048576).toFixed(2)} MB → 截断副本 ${((buf.length - CUT_BYTES) / 1048576).toFixed(2)} MB`);

const { evaluate, shot, close, version, send, logs } = await launch({ port: 9399, outDir: OUT, width: 1280, height: 900 });
console.log('browser:', version.Browser);
await send('Page.navigate', { url: 'file:///' + TEMP.replace(/\\/g, '/') });
await sleep(8000); // 等内联资源等待超时（5s）+ 余量

const s = JSON.parse(
  await evaluate(`JSON.stringify({
    hasFm: typeof window.__fm,
    standaloneMissing: !window.__FM_STANDALONE,
    styleSegChildren: document.getElementById('styleSeg').children.length,
    zoomLabel: document.getElementById('zoomVal').textContent,
    canvasPixel: (() => { const c = document.getElementById('view').getContext('2d'); const d = c.getImageData(4, 4, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; })(),
    problemShown: getComputedStyle(document.getElementById('problem')).display !== 'none',
    problemTitle: document.getElementById('problemTitle').textContent,
    problemMsg: document.getElementById('problemMsg').textContent.slice(0, 90)
  })`)
);
await shot('文件不完整时的提示.png');
console.log('截断副本表现 →', JSON.stringify(s, null, 1));

const pass =
  s.hasFm === 'object' &&        // 应用脚本仍然执行了
  s.styleSegChildren > 0 &&      // 界面正常建起来
  s.canvasPixel !== '0,0,0' &&   // 画布在渲染（不是黑屏）
  s.problemShown &&              // 明确弹出了原因
  s.problemTitle.includes('失败');
console.log(pass ? '\nPASS 截断时界面可用且明确报因' : '\nFAIL 截断时仍然没有说清楚');

rmSync(TEMP, { force: true });
const errs = logs.filter((l) => /EXCEPTION|TypeError/.test(l));
console.log('异常日志：', errs.length ? errs.slice(0, 2).join(' | ') : '无');
close();
process.exit(pass ? 0 : 1);
