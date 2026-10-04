/** 可爱风：大眼睛 + 双高光 + 腮红 + 猫嘴 */
import { clamp01, smoothstep, ellipse, roundRect, sampleQuad, strokePath, sparkle, drawChevron } from './util.js';

function eyeClosedArc(ctx, w, h, lw, color) {
  ctx.beginPath();
  ctx.arc(0, h * 0.55, w * 0.44, Math.PI * 1.12, Math.PI * 1.88);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawEye(ctx, e, pal, o = {}) {
  const w = Math.max(e.w * 1.2, 6);
  const openC = clamp01(e.open);
  const joyK = smoothstep(0.42, 0.85, e.joy) * smoothstep(0.2, 0.6, openC);
  const h = Math.max(w * 0.92 * openC, w * 0.05);
  const lw = Math.max(2.4, w * 0.085);

  // ---- 闭眼：尖括号（左眼 `>`、右眼 `<`，合起来就是 `> <`）----
  if (openC < 0.14) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.tilt);
    if (o.wink) {
      drawChevron(ctx, w, o.apex != null ? o.apex : 1, { color: pal.ink, lw: lw * 1.25, sparkle: !!o.sparkle });
    } else {
      // 睡着时还是老实的一条线，跟"眨眼"区分开
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, 0);
      ctx.lineTo(w * 0.5, 0);
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = lw * 1.3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.tilt);

  // ---- 睁着（或半睁）的眼睛 ----
  if (joyK < 0.995) {
    ctx.save();
    ctx.globalAlpha = 1 - joyK;

    ellipse(ctx, 0, 0, w / 2, h / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.save();
    ellipse(ctx, 0, 0, w / 2, h / 2);
    ctx.clip();
    const ir = w * 0.33;
    const ix = e.gazeX * w * 0.14;
    const iy = e.gazeY * h * 0.26;
    const grad = ctx.createRadialGradient(ix - ir * 0.3, iy - ir * 0.4, ir * 0.1, ix, iy, ir * 1.15);
    grad.addColorStop(0, '#5b4a6b');
    grad.addColorStop(0.55, pal.ink);
    grad.addColorStop(1, '#141018');
    ctx.fillStyle = grad;
    ellipse(ctx, ix, iy, ir, ir);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ellipse(ctx, ix, iy, ir * 0.52, ir * 0.52);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ellipse(ctx, ix - ir * 0.32, iy - ir * 0.38, ir * 0.34, ir * 0.3, -0.5);
    ctx.fill();
    ctx.globalAlpha = (1 - joyK) * 0.75;
    ellipse(ctx, ix + ir * 0.38, iy + ir * 0.42, ir * 0.16, ir * 0.16);
    ctx.fill();
    ctx.globalAlpha = 1 - joyK;
    ctx.restore();

    // 眼眶 + 上睫线
    ellipse(ctx, 0, 0, w / 2, h / 2);
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = lw;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.lineWidth = lw * 1.75;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 外眼角睫毛
    const s = e.side;
    ctx.lineWidth = lw * 0.9;
    for (let i = 0; i < 2; i++) {
      const bx = s * (w / 2 - i * w * 0.12);
      const by = -h / 2 + i * h * 0.06;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + s * w * (0.14 + i * 0.03), by - w * (0.13 - i * 0.04));
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 开心时的弯弯眼 ----
  if (joyK > 0.005) {
    ctx.save();
    ctx.globalAlpha = joyK;
    eyeClosedArc(ctx, w, h, lw * 1.5, pal.ink);
    ctx.restore();
  }

  ctx.restore();
}

function drawBrow(ctx, br, pal) {
  const w = Math.max(br.w * 0.86, 10);
  const lift = -br.raise * w * 0.3 - br.innerUp * w * 0.08 + br.down * w * 0.16;
  ctx.save();
  ctx.translate(br.x, br.y + lift);
  ctx.rotate(br.angle - br.side * 0.04 - br.innerUp * br.side * 0.16 + br.down * br.side * 0.2);
  const thick = Math.max(3.4, w * 0.135);
  const p0 = { x: -w / 2, y: w * 0.1 };
  const p1 = { x: 0, y: -w * 0.06 };
  const p2 = { x: w / 2, y: w * 0.04 };
  strokePath(ctx, sampleQuad(p0, p1, p2, 16), {
    width: (t) => thick * (0.55 + Math.sin(t * Math.PI) * 0.75),
    color: pal.ink,
    alpha: 0.92,
  });
  ctx.restore();
}

function drawMouth(ctx, m, pal, t) {
  const mw = Math.max(m.w * (1 + 0.4 * m.stretch - 0.18 * m.pucker + 0.25 * m.smile), 14);
  const open = clamp01(m.open);
  const smile = clamp01(m.smile);
  const pucker = clamp01(m.pucker);
  ctx.save();
  ctx.translate(m.x + m.shift * mw * 0.18, m.y);
  ctx.rotate(0);

  if (open > 0.1) {
    const rx = mw * (0.34 + 0.2 * (1 - pucker)) * (1 + 0.22 * smile);
    const ry = Math.max(mw * 0.62 * open + mw * 0.05, 3);
    const g = ctx.createLinearGradient(0, -ry, 0, ry);
    g.addColorStop(0, '#7a2f42');
    g.addColorStop(1, '#3d1622');
    ctx.fillStyle = g;
    ellipse(ctx, 0, 0, rx, ry);
    ctx.fill();

    ctx.save();
    ellipse(ctx, 0, 0, rx, ry);
    ctx.clip();
    // 舌头
    if (m.tongue > 0.08) {
      ctx.fillStyle = '#ff8fa8';
      ellipse(ctx, 0, ry * (1.25 - 0.75 * m.tongue), rx * 0.72, ry * 0.62);
      ctx.fill();
    }
    // 上排牙齿
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    roundRect(ctx, -rx * 0.94, -ry * 1.15, rx * 1.88, Math.max(2, ry * 0.42), ry * 0.12);
    ctx.fill();
    ctx.restore();

    ellipse(ctx, 0, 0, rx, ry);
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = Math.max(2, mw * 0.055);
    ctx.stroke();
  } else {
    // 闭嘴：猫嘴 ω 或微笑弧
    const sag = smile * mw * 0.5 - m.frown * mw * 0.42 - m.press * mw * 0.06 + (1 - smile) * mw * 0.1;
    const lw = Math.max(2.6, mw * 0.075);
    if (pucker > 0.45) {
      const r = mw * (0.16 + 0.14 * pucker);
      ellipse(ctx, 0, r * 0.4, r, r * 0.9);
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.fillStyle = 'rgba(122,47,66,0.55)';
      ctx.fill();
    } else if (smile > 0.5 && m.frown < 0.3) {
      // 猫嘴：两段小弧
      const r = mw * 0.3;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.85, -r * 0.15, r * 0.72, s > 0 ? Math.PI * 1.05 : Math.PI * 1.35, s > 0 ? Math.PI * 1.95 : Math.PI * 1.65, s < 0);
        ctx.stroke();
      }
    } else {
      const half = mw * 0.46;
      strokePath(
        ctx,
        sampleQuad({ x: -half, y: -sag * 0.2 }, { x: 0, y: sag }, { x: half, y: -sag * 0.2 }, 20),
        { width: (k) => lw * (0.7 + Math.sin(k * Math.PI) * 0.8), color: pal.ink }
      );
    }
  }
  ctx.restore();
}

export function draw(ctx, S, env, part) {
  const { W, H, t, pal } = env;
  // part === 'features' 时只画五官、不铺背景：多人同框时背景只画一次
  if (part !== 'features') {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, pal.bg);
    g.addColorStop(1, pal.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 缓慢漂浮的柔光斑
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const rr = Math.min(W, H) * (0.34 + i * 0.12);
      const cx = W * 0.5 + Math.sin(t * 0.13 + i * 2.1) * W * 0.24;
      const cy = H * 0.5 + Math.cos(t * 0.11 + i * 1.7) * H * 0.2;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      rg.addColorStop(0, i % 2 ? `${pal.soft}bb` : `${pal.accent}33`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    // 头部光环
    const halo = ctx.createRadialGradient(S.face.cx, S.face.cy, S.face.w * 0.2, S.face.cx, S.face.cy, S.face.w * 1.9);
    halo.addColorStop(0, 'rgba(255,255,255,0.85)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
  }

  // 腮红
  const blush = clamp01(S.cheek.blush);
  if (blush > 0.02 || S.cheek.puff > 0.02) {
    const a = clamp01(blush * 0.85 + S.cheek.puff * 0.5) * 0.62;
    for (const s of [-1, 1]) {
      const bx = S.face.cx + s * S.face.w * 0.36;
      const by = S.face.cy + S.face.h * 0.13;
      const rx = S.face.w * (0.19 + S.cheek.puff * 0.07);
      const rg = ctx.createRadialGradient(bx, by, 0, bx, by, rx);
      rg.addColorStop(0, `rgba(255,122,150,${a})`);
      rg.addColorStop(1, 'rgba(255,122,150,0)');
      ctx.fillStyle = rg;
      ellipse(ctx, bx, by, rx, rx * 0.72);
      ctx.fill();
    }
  }

  drawBrow(ctx, S.brows[0], pal);
  drawBrow(ctx, S.brows[1], pal);

  // 鼻子：小小一颗
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = pal.accent;
  const nw = Math.max(S.nose.w * 0.24, 4) * (1 + S.nose.sneer * 0.35);
  ctx.beginPath();
  ctx.moveTo(S.nose.x, S.nose.y + nw * 0.7);
  ctx.quadraticCurveTo(S.nose.x - nw * 0.6, S.nose.y - nw * 0.3, S.nose.x - nw * 0.18, S.nose.y - nw * 0.35);
  ctx.quadraticCurveTo(S.nose.x, S.nose.y - nw * 0.55, S.nose.x + nw * 0.18, S.nose.y - nw * 0.35);
  ctx.quadraticCurveTo(S.nose.x + nw * 0.6, S.nose.y - nw * 0.3, S.nose.x, S.nose.y + nw * 0.7);
  ctx.fill();
  ctx.restore();

  drawMouth(ctx, S.mouth, pal, t);
  // 醒着闭眼 = 尖括号：屏幕左边那只画 `>`、右边那只画 `<`；只有一只眼闭着就是真的在 wink，加颗星
  const awake = S.sleepy < 0.5;
  const apexOf = (e) => (e.x < S.face.cx ? 1 : -1);
  drawEye(ctx, S.eyes[0], pal, { wink: awake, apex: apexOf(S.eyes[0]), sparkle: awake && S.eyes[1].open > 0.4 });
  drawEye(ctx, S.eyes[1], pal, { wink: awake, apex: apexOf(S.eyes[1]), sparkle: awake && S.eyes[0].open > 0.4 });

  // 惊讶小星星
  if (S.mood.surprise > 0.45) {
    const k = smoothstep(0.45, 0.9, S.mood.surprise);
    const r = Math.max(8, S.face.w * 0.08);
    const spots = [
      [S.face.cx - S.face.w * 0.62, S.face.cy - S.face.h * 0.3],
      [S.face.cx + S.face.w * 0.66, S.face.cy - S.face.h * 0.16],
      [S.face.cx + S.face.w * 0.42, S.face.cy + S.face.h * 0.35],
    ];
    spots.forEach(([x, y], i) => {
      const pulse = 0.7 + 0.3 * Math.sin(t * 6 + i);
      sparkle(ctx, x, y, r * pulse, pal.pop, k * 0.9);
    });
  }
}

export const meta = { id: 'kawaii', name: '可爱' };
