/**
 * 本机静态服务：只监听 127.0.0.1，只服务本目录。
 * 浏览器不允许 file:// 页面取用本地 wasm 与摄像头，所以需要它。
 * 用法： node serve.mjs [端口] [--no-open]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const basePort = Number(args.find((a) => /^\d+$/.test(a)) || 8777);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const abs = normalize(join(ROOT, p));
  if (!abs.startsWith(ROOT + sep) && abs !== ROOT) return null;
  return abs;
}

const server = createServer(async (req, res) => {
  const abs = safePath(req.url || '/');
  if (!abs) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      res.writeHead(302, { Location: req.url.replace(/\/?$/, '/') + 'index.html' }).end();
      return;
    }
    const ext = extname(abs).toLowerCase();
    const body = await readFile(abs);
    const cache = ['.wasm', '.task', '.data'].includes(ext) ? 'public, max-age=86400' : 'no-store';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cache,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + req.url);
  }
});

let port = basePort;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < basePort + 12) {
    port += 1;
    server.listen(port, '127.0.0.1');
  } else {
    console.error('服务启动失败：', err.message);
    process.exit(1);
  }
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/index.html`;
  console.log('');
  console.log('  五官镜像 · Face Feature Mirror');
  console.log('  ----------------------------------------');
  console.log('  页面地址： ' + url);
  console.log('  全部计算在本机完成，画面不上传。');
  console.log('  关掉这个窗口（或按 Ctrl+C）即停止服务。');
  console.log('');
  if (!noOpen) {
    try {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {
      console.log('  （自动打开浏览器失败，请手动复制上面的地址）');
    }
  }
});
