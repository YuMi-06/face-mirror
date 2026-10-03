/** 抽象风：几何块面 + 粗描边，包豪斯式的五官 */
import { clamp01, ellipse, roundRect, sampleQuad, strokePath } from './util.js';

function capsule(ctx, x, y, w, h) {
  roundRect(ctx, x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
}

function drawEye(ctx, e, pal) {
  const R = Math.max(e.w * 0.56, 8);
  const lw = Math.max(3, R * 0.18);
  const open = clamp01(e.open);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.tilt);
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';

  if (open < 0.14) {
    ctx.beginPath();
    ctx.moveTo(-R * 1.08, 0);
    ctx.lineTo(R * 1.08, 0);
    ctx.stroke();
  } else {
    const ry = R * open;
    ellipse(ctx, 0, 0, R, ry, e.tilt * 0);
    ctx.stroke();
    const pr = R * 0.36;
    const px = e.gazeX * (R - pr * 1.5);
    const py = e.gazeY * Math.max(ry - pr * 1.2, 0);
    ctx.fillStyle = pal.accent;
    ellipse(ctx, px, py, pr, Math.min(pr, ry * 0.95));
    ctx.fill();
  }
  ctx.restore();
}

function drawBrow(ctx, br, pal) {
  const w = Math.max(br.w * 0.82, 12);
  const thick = Math.max(4, w * 0.16);
  const lift = -br.raise * w * 0.3 - br.innerUp * w * 0.06 + br.down * w * 0.18;
  ctx.save();
  ctx.translate(br.x, br.y + lift);
  ctx.rotate(br.angle + br.side * (br.innerUp * 0.2 - br.down * 0.24));
  ctx.fillStyle = pal.ink;
  capsule(ctx, 0, 0, w, thick);
  ctx.fill();
  ctx.restore();
}

export function draw(ctx, S, env) {
  const { W, H, t, pal } = env;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // 背景构成：一个大圆 + 一条细环
  const unit = Math.max(S.face.w, Math.min(W, H) * 0.22);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pal.soft;
  ellipse(ctx, W * 0.5 + Math.sin(t * 0.16) * W * 0.06, H * 0.5, unit * 1.25, unit * 1.25);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = Math.max(2, unit * 0.012);
  ctx.beginPath();
  ctx.arc(W * 0.5, H * 0.5, unit * (1.55 + 0.02 * Math.sin(t * 0.5)), t * 0.25, t * 0.25 + Math.PI * 1.35);
  ctx.stroke();
  ctx.restore();

  // 腮红：几道短横线（别画成斜线，会被读成眼泪/胡须）
  const blush = clamp01(S.cheek.blush + S.cheek.puff * 0.6);
  if (blush > 0.05) {
    ctx.save();
    ctx.globalAlpha = 0.22 + blush * 0.4;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = Math.max(3, S.face.w * 0.045);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const bx = S.face.cx + s * S.face.w * 0.33;
      const by = S.face.cy + S.face.h * 0.04;
      const len = S.face.w * 0.09;
      for (let i = 0; i < 2; i++) {
        const w = len * (1 - i * 0.35);
        const yy = by + (i - 0.5) * S.face.w * 0.055;
        ctx.beginPath();
        ctx.moveTo(bx - w / 2, yy);
        ctx.lineTo(bx + w / 2, yy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBrow(ctx, S.brows[0], pal);
  drawBrow(ctx, S.brows[1], pal);

  // 鼻子：三角
  const nw = Math.max(S.nose.w * 0.42, 8) * (1 + S.nose.sneer * 0.3);
  ctx.save();
  ctx.translate(S.nose.x, S.nose.y);
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = Math.max(2.4, nw * 0.16);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-nw * 0.55, -nw * 0.45);
  ctx.lineTo(nw * 0.55, -nw * 0.45);
  ctx.lineTo(0, nw * 0.55);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // 嘴
  const m = S.mouth;
  const mw = Math.max(m.w * (1 + 0.3 * m.stretch + 0.2 * m.smile), 16);
  const open = clamp01(m.open);
  ctx.save();
  ctx.translate(m.x + m.shift * mw * 0.16, m.y);
  if (open > 0.12) {
    const w = mw * 0.7 * (1 - 0.25 * m.pucker);
    const h = Math.max(mw * 0.85 * open, 4);
    ctx.fillStyle = pal.accent;
    capsule(ctx, 0, 0, w, h);
    ctx.fill();
    if (m.tongue > 0.15) {
      ctx.fillStyle = pal.pop;
      capsule(ctx, 0, h * (0.5 - 0.35 * m.tongue), w * 0.42, h * 0.34);
      ctx.fill();
    }
  } else {
    const sag = m.smile * mw * 0.42 - m.frown * mw * 0.4;
    const half = mw * 0.42;
    const thick = Math.max(3.4, mw * 0.11);
    if (m.pucker > 0.5) {
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = thick;
      ellipse(ctx, 0, 0, mw * 0.13, mw * 0.16);
      ctx.stroke();
    } else {
      strokePath(
        ctx,
        sampleQuad({ x: -half, y: -sag * 0.3 }, { x: 0, y: sag }, { x: half, y: -sag * 0.3 }, 18),
        { width: () => thick, color: pal.ink }
      );
    }
  }
  ctx.restore();

  drawEye(ctx, S.eyes[0], pal);
  drawEye(ctx, S.eyes[1], pal);
}

export const meta = { id: 'abstract', name: '抽象' };
