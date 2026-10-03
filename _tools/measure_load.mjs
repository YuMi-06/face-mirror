// 量载入耗时：从导航开始到 __fm.ready，拆成 解析/UI/模型 三段。
// usage: node measure_load.mjs <url> [url2]
// 需要 danger-full-access（本机沙箱挡 GUI）
import { launch } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const urls = process.argv.slice(2).filter((a) => /^(file|http)/.test(a));
if (!urls.length) urls.push('file:///D:/桌面/机器人/face-mirror/五官镜像.html');

const { evaluate, waitFor, close, version, send, logs } = await launch({
  port: 9397,
  outDir: 'D:\\桌面\\机器人\\face-mirror\\_verify',
  width: 1280,
  height: 820,
  fakeDevice: true,
});
console.log('browser:', version.Browser, '\n');

for (const url of urls) {
  const results = [];
  for (let run = 1; run <= 2; run++) {
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    const t0 = Date.now();
    await send('Page.navigate', { url });
    // 开页 300ms 时看载入胶囊状态 + 截一张：这才是用户双击后第一眼看到的东西
    if (run === 1) {
      await sleep(300);
      const chip = await evaluate(
        `JSON.stringify({ chip: getComputedStyle(document.getElementById('boot')).display, text: document.getElementById('bootMsg').textContent, status: document.getElementById('statusText').textContent })`
      ).catch(() => '{}');
      console.log('    开页 300ms 时：' + chip);
      const png = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync('D:\\桌面\\机器人\\face-mirror\\_verify\\load', { recursive: true });
      writeFileSync('D:\\桌面\\机器人\\face-mirror\\_verify\\load\\开页300ms.png', Buffer.from(png.data, 'base64'));
    }
    const ok = await waitFor('!!(window.__fm && window.__fm.ready)', 200, 50);
    const wall = Date.now() - t0;
    const T = await evaluate('JSON.stringify(window.__fm ? window.__fm.timings() : {})').catch(() => '{}');
    results.push({ run, ok, wall, T: JSON.parse(T) });
  }
  console.log('=== ' + url + ' ===');
  for (const r of results) {
    const T = r.T;
    const nav = T.nav || {};
    const ms = (a, b) => (a != null && b != null ? (a - b).toFixed(0) + 'ms' : '-');
    console.log(
      `  第 ${r.run} 次 ready=${r.ok} 实际等待 ${r.wall}ms\n` +
        `    点开→HTML解析完(DOMContentLoaded) ${nav.domContentLoaded?.toFixed(0)}ms  load事件 ${nav.load?.toFixed(0)}ms\n` +
        `    内联资源脚本执行完        ${T.payload?.toFixed(0)}ms\n` +
        `    应用脚本开始             ${T.main?.toFixed(0)}ms   (解析+执行内联资源 ${ms(T.main, 0)})\n` +
        `    UI 建好、开始载模型       ${T.initStart?.toFixed(0)}ms\n` +
        `    模型就绪 ready           ${T.ready?.toFixed(0)}ms\n` +
        `    ── 拆解：资源解析 ${ms(T.payload, 0)} | 应用启动 ${ms(T.initStart, T.main)} | 模型载入 ${ms(T.ready, T.initStart)}\n` +
        `    ── 模型载入内部：解码 ${ms(T.decodeEnd, T.decodeStart)} | fileset ${ms(T.filesetEnd, T.filesetStart)} | 建任务 ${ms(T.createEnd, T.createStart)}`
    );
  }
}
const errs = logs.filter((l) => /EXCEPTION|TypeError/.test(l));
console.log('\n异常：', errs.length ? errs.slice(0, 3).join(' | ') : '无');
close();
