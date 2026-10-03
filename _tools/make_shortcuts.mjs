// 生成"绕开客户端预览器、直接用浏览器打开"的两个入口：
//   ① 打开-五官镜像.url  —— Windows 快捷方式，双击交给默认浏览器（你这台机器 = Edge）
//   ② 打开-五官镜像.bat  —— ShellExecute 打开，纯 ASCII + CRLF（不塞中文路径，靠通配符拿文件名）
// 起因：在聊天窗口里点文件卡片 = 客户端内置预览器（blob:dsh-app://…）打开，
//       那个环境会拦掉 WebAssembly 相关加载，页面永远起不来。
// usage: node make_shortcuts.mjs
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, '五官镜像.html');
if (!existsSync(HTML)) throw new Error('找不到 五官镜像.html');

const fileUrl = 'file:///' + HTML.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace('file%3A%2F%2F%2F', 'file:///');
// 注意：盘符那段不能被编码，所以手工拼
const encoded = 'file:///' + HTML.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:').split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/');

const urlFile = join(ROOT, '打开-五官镜像.url');
writeFileSync(urlFile, `[InternetShortcut]\r\nURL=${encoded}\r\nIconIndex=0\r\n`, 'ascii');

const batFile = join(ROOT, '打开-五官镜像.bat');
const bat = [
  '@echo off',
  'rem Open the single-file viewer (the .html in this folder) in the DEFAULT BROWSER.',
  'rem ASCII-only + CRLF on purpose: a UTF-8 / bare-LF .bat breaks cmd.exe parsing.',
  'rem The Chinese file name is picked up from the file system, never typed here.',
  'cd /d "%~dp0"',
  'for %%F in (*.html) do if /i not "%%~nxF"=="index.html" start "" "%%~fF"',
  'exit /b 0',
  '',
].join('\r\n');
writeFileSync(batFile, bat, 'ascii');

// 自检
const enc = encoded;
const decoded = decodeURIComponent(enc.replace(/^file:\/\/\//, '').replace(/\//g, '\\'));
console.log('单文件版 :', (statSync(HTML).size / 1048576).toFixed(2), 'MB');
console.log('① .url   :', urlFile);
console.log('   URL   :', enc);
console.log('   解码后指向存在的文件?', existsSync(decoded), '→', decoded);
console.log('② .bat   :', batFile);
const bytes = Buffer.from(bat, 'ascii');
console.log('   CRLF =', (bat.match(/\r\n/g) || []).length, ' 裸 LF =', (bat.match(/(?<!\r)\n/g) || []).length,
  ' 非 ASCII 字节 =', [...bytes].filter((b) => b > 127).length);
