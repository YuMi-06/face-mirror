// 用官方测试肖像量一遍真实数值，用来校准 signals.js 里的阈值（不是猜的）。
// usage: node probe_metrics.mjs <pageUrl> <outDir>
import { launch } from './cdp.mjs';

const PAGE = process.argv[2] || 'http://127.0.0.1:8778/index.html';
const OUT = process.argv[3] || 'D:\\桌面\\机器人\\face-mirror\\_verify';

const { evaluate, waitFor, logs, close, version } = await launch({ port: 9383, outDir: OUT });
console.log('browser:', version.Browser);
await evaluate(`location.href = ${JSON.stringify(PAGE)}`);
const ok = await waitFor('!!(window.__fm && window.__fm.ready)');
console.log('page ready:', ok);

const js = `(async () => {
  const m = await import('./vendor/mediapipe/vision_bundle.mjs');
  const fileset = await m.FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const lm = await m.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: './vendor/models/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: true,
  });
  const img = new Image();
  img.src = './_tools/portrait.jpg';
  await img.decode();
  const r = lm.detect(img);
  const P = r.faceLandmarks[0];
  const d = (a, b) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y);
  const bs = {};
  for (const c of r.faceBlendshapes[0].categories) bs[c.categoryName] = +c.score.toFixed(4);
  const eyes = { A: { o: 33, i: 133, u: 159, l: 145, iris: 468 }, B: { o: 263, i: 362, u: 386, l: 374, iris: 473 } };
  const eyeM = {};
  for (const k of ['A', 'B']) {
    const e = eyes[k];
    const w = d(e.o, e.i);
    const h = d(e.u, e.l);
    const mcx = (P[e.o].x + P[e.i].x) / 2, mcy = (P[e.o].y + P[e.i].y) / 2;
    eyeM[k] = {
      cornerW: +w.toFixed(5), lidH: +h.toFixed(5), ear: +(h / w).toFixed(3),
      irisDX: +((P[e.iris].x - mcx) / w).toFixed(3), irisDY: +((P[e.iris].y - mcy) / w).toFixed(3),
    };
  }
  const interEye = Math.hypot((P[33].x + P[133].x) / 2 - (P[263].x + P[362].x) / 2, (P[33].y + P[133].y) / 2 - (P[263].y + P[362].y) / 2);
  const faceH = d(10, 152);
  const faceW = d(234, 454);
  const mouthGap = d(13, 14);
  const mcx2 = (P[13].x + P[14].x) / 2, mcy2 = (P[13].y + P[14].y) / 2;
  const cornerY = (P[61].y + P[291].y) / 2;
  const cornerLift = mcy2 - cornerY;
  const browGapA = P[159].y - (P[70].y + P[63].y + P[105].y + P[66].y + P[107].y) / 5;
  const browGapB = P[386].y - (P[300].y + P[293].y + P[334].y + P[296].y + P[336].y) / 5;
  const bbox = (() => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of P) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x0: +x0.toFixed(4), y0: +y0.toFixed(4), x1: +x1.toFixed(4), y1: +y1.toFixed(4) };
  })();
  lm.close();
  return JSON.stringify({
    imgSize: [img.naturalWidth, img.naturalHeight],
    interEye: +interEye.toFixed(5), faceH: +faceH.toFixed(5), faceW: +faceW.toFixed(5),
    ratio: { faceW_over_H: +(faceW / faceH).toFixed(3), interEye_over_faceH: +(interEye / faceH).toFixed(3) },
    mouth: {
      gap: +mouthGap.toFixed(5), gap_over_interEye: +(mouthGap / interEye).toFixed(3), gap_over_faceH: +(mouthGap / faceH).toFixed(3),
      width: +d(61, 291).toFixed(5), width_over_faceW: +(d(61, 291) / faceW).toFixed(3),
      cornerLift: +cornerLift.toFixed(5), lift_over_interEye: +(cornerLift / interEye).toFixed(3), lift_over_faceH: +(cornerLift / faceH).toFixed(3),
    },
    brow: {
      A_gap: +browGapA.toFixed(5), A_over_interEye: +(browGapA / interEye).toFixed(3), A_over_faceH: +(browGapA / faceH).toFixed(3),
      B_gap: +browGapB.toFixed(5), B_over_interEye: +(browGapB / interEye).toFixed(3),
    },
    eyes: eyeM,
    bbox,
    blendshapes: bs,
  });
})()`;

const out = await evaluate(js);
console.log(out);
console.log('--- logs ---');
console.log(logs.filter((l) => !/GL Driver|gl_context/.test(l)).slice(0, 20).join('\n'));
close();
