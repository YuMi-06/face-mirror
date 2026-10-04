// 诊断：多人同框时，每个人的几何数据到底对不对（眼睛/嘴应当落在自己的脸框里）
import { launch } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = process.argv[2] || 'file:///D:/桌面/机器人/face-mirror/五官镜像.html';
const Y4M = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_tools\\face_two.y4m';
const OUT = 'D:\\桌面\\机器人\\face-mirror\\_verify\\multi';

const { evaluate, close, version, send, waitFor } = await launch({ port: 9413, outDir: OUT, y4m: Y4M, width: 1280, height: 820 });
console.log('browser:', version.Browser);
await send('Page.navigate', { url: PAGE });
console.log('ready:', await waitFor('!!(window.__fm && window.__fm.ready)', 60, 500));
await sleep(5000);

for (let round = 1; round <= 3; round++) {
  const p = JSON.parse(await evaluate('JSON.stringify(window.__fm.people())'));
  console.log(`\n第 ${round} 次采样：人数 ${p.onScreen}，当前 ${p.activeId}`);
  for (const q of p.list) {
    const f = q.face || {};
    const inFace = (pt) => (pt && f.cx ? Math.abs(pt.x - f.cx) < f.w * 1.2 && Math.abs(pt.y - f.cy) < f.h * 1.5 : false);
    console.log(
      `  #${q.index} id=${q.id} ${q.active ? '[当前]' : '      '} 脸 c=(${f.cx},${f.cy}) ${f.w}×${f.h}` +
        `  眼[${(q.eyes || []).map((e) => `${e.x},${e.y} w${e.w}`).join(' | ')}]` +
        `  嘴(${q.mouth ? q.mouth.x + ',' + q.mouth.y : '-'}) w${q.mouth ? q.mouth.w : '-'}` +
        `  → 眼在脸内:${(q.eyes || []).every(inFace)} 嘴在脸内:${inFace(q.mouth)}`
    );
  }
  await sleep(1200);
}
close();
