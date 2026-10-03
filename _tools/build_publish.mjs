/**
 * 组装待发布的仓库内容到 publish/。
 * 只复制代码与文档；**排除**任何含真人照片的中间产物（_verify/、portrait.jpg 等）。
 * usage: node _tools/build_publish.mjs
 */
import { cpSync, mkdirSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'publish');

// 要复制的代码 / 资源（文档由人写好放在 publish/ 里，这里不动）
const FILES = ['index.html', '五官镜像.html', 'serve.mjs', '启动-面容镜像.bat', '打开-五官镜像.bat', '打开-五官镜像.url'];
const DIRS = ['src', 'vendor', '_tools'];

// 明确排除的东西
const EXCLUDE = [
  /portrait\.jpg$/i, // MediaPipe 的测试肖像（真人照片）
  /face_test\.y4m$/i,
  /\.log$/i,
  /node_modules/,
  /_verify/,
  /_edge-profile/,
];

mkdirSync(OUT, { recursive: true });
let copied = 0;
let bytes = 0;
const skipped = [];

function keep(p) {
  return !EXCLUDE.some((re) => re.test(p));
}

function copyDir(src, dst, rel = '') {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const relPath = rel ? rel + '/' + name : name;
    if (!keep(relPath)) {
      skipped.push(relPath);
      continue;
    }
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d, relPath);
    else {
      cpSync(s, d);
      copied++;
      bytes += st.size;
    }
  }
}

for (const f of FILES) {
  const s = join(ROOT, f);
  if (!existsSync(s)) {
    console.log('跳过（不存在）：', f);
    continue;
  }
  cpSync(s, join(OUT, f));
  copied++;
  bytes += statSync(s).size;
}
for (const d of DIRS) {
  const s = join(ROOT, d);
  if (existsSync(s)) copyDir(s, join(OUT, d), d);
}

// 生成 .nojekyll：GitHub Pages 不做 Jekyll 处理（否则非 ASCII 文件名与 17 MB HTML 会被它折腾）
writeFileSync(join(OUT, '.nojekyll'), '');

console.log('publish/ 组装完成');
console.log('  文件数：', copied);
console.log('  体积  ：', (bytes / 1048576).toFixed(2), 'MB');
console.log('  排除  ：', skipped.length ? skipped.join(', ') : '（无）');
const must = ['README.md', 'LICENSE', 'THIRD-PARTY.md', '.nojekyll'];
for (const m of must) {
  console.log('  ' + (existsSync(join(OUT, m)) ? '✓' : '✗ 缺失') + ' ' + m);
}
// 顶层清单
console.log('顶层：', readdirSync(OUT).join('  '));
