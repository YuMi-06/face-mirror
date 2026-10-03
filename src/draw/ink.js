/** 水墨风：毛笔变宽笔触 + 墨点 + 宣纸质感 */
import { clamp01, blob, ellipse, noiseTexture, sampleQuad, strokePath, rng } from './util.js';

function ellPts(cx, cy, rx, ry, a0, a1, n = 26) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

function drawEye(ctx, e, pal, idx) {
  const R = Math.max(e.w * 0.6, 9);
  const open = clamp01(e.open);
  const seed = 1000 + idx * 37;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.tilt);

  if (open < 0.16) {
    // 闭眼：一道弯笔
    strokePath(ctx, sampleQuad({ x: -R * 1.05, y: R * 0.12 }, { x: 0, y: -R * 0.42 }, { x: R * 1.05, y: R * 0.12 }, 20), {
      width: (t) => R * 0.26 * (0.35 + Math.sin(t * Math.PI) * 1.05),
      color: pal.ink,
      seed,
      wobble: R * 0.02,
    });
  } else {
    const ry = R * open;
    // 眼白淡墨
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = pal.ink;
    ellipse(ctx, 0, 0, R * 1.05, ry * 1.05);
    ctx.fill();
    ctx.restore();

    // 眼眶：上眼睑重、下眼睑轻
    strokePath(ctx, ellPts(0, 0, R, ry, Math.PI * 1.02, Math.PI * 1.98), {
      width: (t) => R * 0.22 * (0.5 + Math.sin(t * Math.PI) * 0.85),
      color: pal.ink,
      seed: seed + 1,
      wobble: R * 0.035,
    });
    strokePath(ctx, ellPts(0, 0, R * 0.98, ry * 0.98, Math.PI * 0.06, Math.PI * 0.94), {
      width: () => R * 0.08,
      color: pal.ink,
      alpha: 0.55,
      seed: seed + 2,
    });
    // 瞳孔：墨点
    const pr = R * 0.42;
    const px = e.gazeX * (R - pr * 1.2);
    const py = e.gazeY * Math.max(ry - pr, 0);
    ctx.save();
    ctx.globalAlpha = 0.92;
    blob(ctx, px, py, pr, Math.min(pr, ry * 0.98), seed + 3, 0.16);
    ctx.fillStyle = pal.ink;
    ctx.fill();
    ctx.globalAlpha = 0.35;
    blob(ctx, px - pr * 0.25, py - pr * 0.3, pr * 0.4, pr * 0.35, seed + 4, 0.3);
    ctx.fillStyle = pal.bg;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawBrow(ctx, br, pal, idx) {
  const w = Math.max(br.w * 0.86, 12);
  const lift = -br.raise * w * 0.3 - br.innerUp * w * 0.06 + br.down * w * 0.18;
  ctx.save();
  ctx.translate(br.x, br.y + lift);
  ctx.rotate(br.angle + br.side * (br.innerUp * 0.18 - br.down * 0.2));
  const p0 = { x: -w / 2, y: w * 0.14 };
  const p1 = { x: 0, y: -w * 0.1 };
  const p2 = { x: w / 2, y: w * 0.06 };
  strokePath(ctx, sampleQuad(p0, p1, p2, 22), {
    width: (t) => w * 0.17 * (0.3 + Math.sin(Math.min(1, t * 1.08) * Math.PI) * 1.15),
    color: pal.ink,
    alpha: 0.9,
    seed: 500 + idx * 13,
    wobble: w * 0.02,
  });
  ctx.restore();
}

export function draw(ctx, S, env) {
  const { W, H, t, pal } = env;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // 宣纸纤维
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(noiseTexture(W, H, { seed: 11, dots: 3200, alpha: 0.16, color: '#8a7a5c', size: 1.5 }), 0, 0);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(noiseTexture(W, H, { seed: 29, dots: 240, alpha: 0.3, color: '#6b5c40', size: 5 }), 0, 0);
  ctx.restore();

  // 远处淡墨：柔和的径向晕，别用硬边块面
  ctx.save();
  const r = rng(97);
  for (let i = 0; i < 3; i++) {
    const cx = W * (0.18 + r() * 0.64) + Math.sin(t * 0.07 + i) * W * 0.03;
    const cy = H * (0.18 + r() * 0.64);
    const rad = Math.min(W, H) * (0.24 + r() * 0.26);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(58,52,42,0.13)');
    g.addColorStop(0.6, 'rgba(58,52,42,0.05)');
    g.addColorStop(1, 'rgba(58,52,42,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 腮红：淡朱砂晕
  const blush = clamp01(S.cheek.blush + S.cheek.puff * 0.6);
  if (blush > 0.05) {
    ctx.save();
    for (const s of [-1, 1]) {
      const bx = S.face.cx + s * S.face.w * 0.37;
      const by = S.face.cy + S.face.h * 0.14;
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = (0.05 + blush * 0.12) * (1 - i * 0.18);
        blob(ctx, bx + (i - 2) * S.face.w * 0.02, by, S.face.w * 0.16, S.face.w * 0.1, 700 + i * 7 + (s > 0 ? 0 : 99), 0.3);
        ctx.fillStyle = pal.accent;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawBrow(ctx, S.brows[0], pal, 0);
  drawBrow(ctx, S.brows[1], pal, 1);

  // 鼻：短挑笔
  const nw = Math.max(S.nose.w * 0.5, 10) * (1 + S.nose.sneer * 0.3 + S.nose.wiggle * 0.1);
  strokePath(
    ctx,
    [
      { x: S.nose.x - nw * 0.1, y: S.nose.y - nw * 0.75 },
      { x: S.nose.x - nw * 0.42, y: S.nose.y + nw * 0.1 },
      { x: S.nose.x + nw * 0.34, y: S.nose.y + nw * 0.4 },
    ],
    { width: (k) => nw * 0.16 * (0.45 + Math.sin(k * Math.PI) * 0.9), color: pal.ink, alpha: 0.85, seed: 31, wobble: nw * 0.03 }
  );

  // 嘴
  const m = S.mouth;
  const mw = Math.max(m.w * (1 + 0.3 * m.stretch), 16);
  const open = clamp01(m.open);
  ctx.save();
  ctx.translate(m.x + m.shift * mw * 0.16, m.y);
  if (open > 0.14) {
    const rx = mw * 0.3 * (1 - 0.3 * m.pucker) * (1 + 0.2 * m.smile);
    const ry = Math.max(mw * 0.62 * open, 3);
    ctx.save();
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.1 + i * 0.06;
      blob(ctx, 0, 0, rx * (1 + i * 0.14), ry * (1 + i * 0.12), 900 + i, 0.22);
      ctx.fillStyle = pal.ink;
      ctx.fill();
    }
    ctx.globalAlpha = 0.75;
    blob(ctx, 0, 0, rx * 0.72, ry * 0.78, 910, 0.2);
    ctx.fillStyle = pal.ink;
    ctx.fill();
    if (m.tongue > 0.15) {
      ctx.globalAlpha = 0.5;
      blob(ctx, 0, ry * (0.8 - 0.6 * m.tongue), rx * 0.6, ry * 0.5, 915, 0.25);
      ctx.fillStyle = pal.accent;
      ctx.fill();
    }
    ctx.restore();
  } else {
    const sag = m.smile * mw * 0.42 - m.frown * mw * 0.4 - m.press * mw * 0.05;
    const half = mw * 0.44;
    strokePath(ctx, sampleQuad({ x: -half, y: -sag * 0.3 }, { x: 0, y: sag }, { x: half, y: -sag * 0.3 }, 24), {
      width: (k) => mw * 0.13 * (0.3 + Math.sin(k * Math.PI) * 1.15),
      color: pal.ink,
      seed: 41,
      wobble: mw * 0.015,
    });
  }
  ctx.restore();

  drawEye(ctx, S.eyes[0], pal, 0);
  drawEye(ctx, S.eyes[1], pal, 1);
}

export const meta = { id: 'ink', name: '水墨' };
