/**
 * 把 publish/ 发布到 GitHub，并开启 Pages（公共可访问的网址）。
 *
 * 为什么不用 git push：本机 git 连不上 github.com（443 超时），
 * 但 fetch 能通，所以整个发布走 GitHub REST API（Git Data API 一次性建树 + 提交）。
 *
 * 需要 GH_TOKEN 环境变量（PowerShell 里： $env:GH_TOKEN = (& gh auth token).Trim()）
 * usage: node _tools/publish_github.mjs [--repo face-mirror] [--dry]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'publish');
const TOKEN = (process.env.GH_TOKEN || '').trim();
const REPO = (process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : 'face-mirror');
const DRY = process.argv.includes('--dry');
const API = 'https://api.github.com';
if (!TOKEN) throw new Error('缺少 GH_TOKEN 环境变量');

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'face-mirror-publisher',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status === 404) return { __status: 404 };
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 240)}`);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      if (i === tries) throw e;
      log(`   重试 ${i}/${tries - 1}：${e.message.slice(0, 80)}`);
      await sleep(1500 * i);
    }
  }
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, base));
    else out.push({ abs: p, rel: relative(base, p).split('\\').join('/'), size: st.size });
  }
  return out;
}

// ---------------- 1. 账号与仓库 ----------------
const me = await api('GET', '/user');
log('账号：', me.login);
if (me.login.toLowerCase() !== 'yumi-06' && !process.argv.includes('--any-owner')) {
  log(`提示：当前 token 属于 ${me.login}，仓库会建在这个账号下。`);
}

let repo = await api('GET', `/repos/${me.login}/${REPO}`);
if (repo.__status === 404) {
  if (DRY) {
    log(`[dry] 会创建公开仓库 ${me.login}/${REPO}`);
    repo = { full_name: `${me.login}/${REPO}`, html_url: `https://github.com/${me.login}/${REPO}` };
  } else {
    repo = await api('POST', '/user/repos', {
      name: REPO,
      description: '五官镜像 · 摄像头识别人脸，页面里只画五官（四种画风，纯本地推理，不上传视频）',
      homepage: `https://${me.login.toLowerCase()}.github.io/${REPO}/`,
      private: false,
      has_issues: true,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    });
    log('已创建公开仓库：', repo.html_url);
  }
} else {
  log('仓库已存在：', repo.html_url, '| 可见性:', repo.visibility);
}

// ---------------- 2. 上传每个文件为 blob ----------------
const files = walk(PUB).sort((a, b) => a.size - b.size); // 小的先传，早点看到进度
log(`\n待上传 ${files.length} 个文件，共 ${(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(2)} MB`);
const tree = [];
for (const f of files) {
  const t0 = Date.now();
  const b64 = readFileSync(f.abs).toString('base64');
  if (DRY) {
    log(`  [dry] ${f.rel}  ${(f.size / 1024).toFixed(0)} KB`);
    continue;
  }
  const blob = await api('POST', `/repos/${me.login}/${REPO}/git/blobs`, { content: b64, encoding: 'base64' });
  tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
  log(`  ✓ ${f.rel.padEnd(34)} ${(f.size / 1024).toFixed(0).padStart(7)} KB  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
if (DRY) process.exit(0);

// ---------------- 3. 建树 + 提交 + 推分支 ----------------
const treeRes = await api('POST', `/repos/${me.login}/${REPO}/git/trees`, { tree });
log('\n树：', treeRes.sha);

const ref = await api('GET', `/repos/${me.login}/${REPO}/git/ref/heads/main`);
const parents = ref.__status === 404 ? [] : [ref.object.sha];
const commit = await api('POST', `/repos/${me.login}/${REPO}/git/commits`, {
  message: `五官镜像 face-mirror：摄像头识别人脸的"只画五官"网页（在线版 + 17 MB 单文件离线版）\n\n共 ${files.length} 个文件。模型与运行时全部随仓库分发，页面不联任何外部服务。`,
  tree: treeRes.sha,
  parents,
});
if (parents.length) {
  await api('PATCH', `/repos/${me.login}/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: true });
  log('已更新 main →', commit.sha.slice(0, 8));
} else {
  await api('POST', `/repos/${me.login}/${REPO}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
  log('已创建 main →', commit.sha.slice(0, 8));
}

// ---------------- 4. 开启 GitHub Pages ----------------
const pagesExisting = await api('GET', `/repos/${me.login}/${REPO}/pages`);
const pagesBody = { source: { branch: 'main', path: '/' } };
if (pagesExisting.__status === 404) {
  const p = await api('POST', `/repos/${me.login}/${REPO}/pages`, pagesBody);
  log('已开启 Pages：', p.html_url || '');
} else {
  await api('PUT', `/repos/${me.login}/${REPO}/pages`, pagesBody);
  log('Pages 已存在，已更新来源。');
}

const site = `https://${me.login.toLowerCase()}.github.io/${REPO}/`;
log('\n站点地址：', site);
log('等待 Pages 构建（首次通常 1–3 分钟）…');
for (let i = 0; i < 40; i++) {
  await sleep(15000);
  const st = await api('GET', `/repos/${me.login}/${REPO}/pages`);
  log(`  [${((i + 1) * 15)}s] status=${st.status || '?'}`);
  if (st.status === 'built') break;
}
log('\n仓库：', repo.html_url);
log('站点：', site);
