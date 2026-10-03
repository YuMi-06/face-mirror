// 迷你打包器：把 src/ 下的 ESM 源码 + vendor 的 vision_bundle.mjs
// 合成**一个经典脚本（IIFE）**，这样就能内联进 HTML、在 file:// 下直接跑
// （file:// 不允许 <script type="module" src="...">，但允许经典脚本）。
//
// 只支持本项目实际用到的语法子集：
//   import { a, b } from './x.js'      （仅具名导入）
//   export const/let/var/function/class/async function
//   export { a, b };
// vendor 那份是压缩过的单行文件，末尾只有一个 export{...}。
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyOf = (abs) => relative(ROOT, abs).split('\\').join('/');

function readModule(abs) {
  return readFileSync(abs, 'utf8');
}

/** vendor 的压缩文件：切掉末尾 export{...}，换成 return {...} */
function transformVendor(src, key) {
  const i = src.lastIndexOf('export{');
  if (i < 0) throw new Error('vendor 文件里找不到 export{...}：' + key);
  const j = src.indexOf('}', i);
  const map = src.slice(i + 'export{'.length, j);
  const body = src.slice(0, i).replace(/\/\/#\s*sourceMappingURL=.*$/m, '');
  const fields = map
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(\S+)\s+as\s+(\S+)$/);
      return m ? `${m[2]}: ${m[1]}` : `${s}: ${s}`;
    });
  return { code: `'use strict';\n${body}\nreturn {${fields.join(',')}};`, exports: [] };
}

/** 我自己的模块：改写 import / export */
function transformModule(src, key) {
  const exports = new Set();
  let out = src;

  out = out.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm, (_m, names, spec) => {
    const target = keyOf(resolve(dirname(resolve(ROOT, key)), spec));
    // 具名导入可能带别名：{ draw as kawaii } → { draw: kawaii }
    const fields = names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = s.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
        return m ? `${m[1]}: ${m[2]}` : s;
      });
    return `const {${fields.join(', ')}} = __M[${JSON.stringify(target)}];`;
  });
  out = out.replace(/^import\s+[\w$]+\s+from\s*['"][^'"]+['"];?\s*$/gm, () => {
    throw new Error('还不支持 default import：' + key);
  });
  out = out.replace(/^export\s*\{([^}]*)\}\s*;?\s*$/gm, (_m, names) => {
    for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      exports.add(n.split(/\s+as\s+/).pop().trim());
    }
    return '';
  });
  out = out.replace(/^export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm, (_m, kw, name) => {
    exports.add(name);
    return `${kw} ${name}`;
  });
  if (/^export\s/m.test(out)) throw new Error('还有没处理的 export 形式：' + key);
  if (/^import\s/m.test(out)) throw new Error('还有没处理的 import 形式：' + key);
  return { code: out, exports: [...exports] };
}

/** 从入口出发按依赖顺序收集模块 */
function collect(entryKey) {
  const seen = new Set();
  const order = [];
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const abs = resolve(ROOT, key);
    const src = readModule(abs);
    for (const m of src.matchAll(/^import\s*\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/gm)) {
      visit(keyOf(resolve(dirname(abs), m[1])));
    }
    order.push({ key, abs, src });
  };
  visit(entryKey);
  return order;
}

export function bundle(entry = 'src/main.js') {
  const mods = collect(entry);
  const parts = [
    '/* 由 _tools/bundle.mjs 生成：源码 ESM → 经典脚本 IIFE */',
    '(function () {',
    'var __M = {};',
  ];
  for (const { key, src } of mods) {
    const isVendor = key.startsWith('vendor/');
    const { code, exports } = isVendor ? transformVendor(src, key) : transformModule(src, key);
    parts.push(`__M[${JSON.stringify(key)}] = (function () {`);
    parts.push(isVendor ? code : `'use strict';\n${code}\nreturn {${exports.join(', ')}};`);
    parts.push('})();');
  }
  parts.push('})();');
  return { code: parts.join('\n'), modules: mods.map((m) => m.key) };
}

if (process.argv[1] && process.argv[1].endsWith('bundle.mjs')) {
  const { code, modules } = bundle(process.argv[2] || 'src/main.js');
  console.log('模块顺序：');
  modules.forEach((m) => console.log('  ' + m));
  console.log('产物长度：', code.length, '字符');
  if (process.argv.includes('--check')) {
    // 语法自检：交给 node 解析（不执行）
    new Function(code);
    console.log('语法检查通过');
  }
}
