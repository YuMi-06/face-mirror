/** 像素风：格子对齐的方块五官 + CRT 质感 */
import { clamp01 } from './util.js';

let scanCache = null;

function scanlines(ctx, W, H, dark) {
  const key = `${W}x${H}:${dark}`;
  if (!scanCache || scanCache.key !== key) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, W);
    cv.height = Math.max(1, H);
    const c = cv.getContext('2d');
    c.fillStyle = dark ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.07)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    scanCache = { key, cv };
  }
  ctx.drawImage(scanCache.cv, 0, 0);
}

export function draw(ctx, S, env) {
  const { W, H, t, pal } = env;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  const avgEye = (S.eyes[0].w + S.eyes[1].w) / 2;
  const cell = Math.max(4, Math.min(40, Math.round(avgEye / 5)));
  const snap = (v) => Math.round(v / cell) * cell;
  const rows = (n) => Math.max(1, Math.round(n));
  const ink = pal.ink;
  const dim = pal.soft;

  // 网格底纹
  ctx.save();
  ctx.globalAlpha = pal.dark ? 0.13 : 0.07;
  ctx.fillStyle = pal.accent;
  for (let x = 0; x < W; x += cell * 2) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += cell * 2) ctx.fillRect(0, y, W, 1);
  ctx.restore();

  // 马赛克柔光块
  ctx.save();
  ctx.globalAlpha = pal.dark ? 0.5 : 0.35;
  ctx.fillStyle = dim;
  const bx = snap(S.face.cx - S.face.w * 0.8);
  const by = snap(S.face.cy - S.face.h * 0.55);
  const bw = rows(S.face.w * 1.6 / cell) * cell;
  const bh = rows(S.face.h * 1.1 / cell) * cell;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();

  const block = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(snap(x), snap(y), Math.max(1, rows(w / cell)) * cell, Math.max(1, rows(h / cell)) * cell);
  };

  // 眉：一条横杠，抬高按格步进
  S.brows.forEach((br) => {
    const step = Math.round(-br.raise * 2 + br.down * 1.4);
    const w = Math.max(3, Math.round(br.w * 0.8 / cell));
    const x0 = snap(br.x) - Math.floor(w / 2) * cell;
    const y0 = snap(br.y) + step * cell;
    for (let i = 0; i < w; i++) {
      const dip = br.side * (i / Math.max(1, w - 1) - 0.5) * br.angle * 2.4;
      block(x0 + i * cell, y0 + Math.round(dip) * cell, cell, cell, ink);
    }
  });

  // 眼：5 宽 × 4 高的方块（格子大小由眼宽定，所以比例和其他画风一致）
  const eyeStencil = [
    [0, 1, 1, 1, 0],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [0, 1, 1, 1, 0],
  ];
  S.eyes.forEach((e) => {
    const open = clamp01(e.open);
    const ox = snap(e.x) - cell * 2;
    const oy = snap(e.y) - cell * 1.5;
    if (open < 0.18) {
      for (let i = 0; i < 5; i++) block(ox + i * cell, oy + cell, cell, cell, ink);
    } else {
      const hRows = open > 0.55 ? 4 : 3;
      for (let r = 0; r < hRows; r++) {
        for (let c = 0; c < 5; c++) {
          if (!eyeStencil[r][c]) continue;
          block(ox + c * cell, oy + r * cell, cell, cell, ink);
        }
      }
      const gx = Math.round(e.gazeX * 1.4);
      const gy = Math.round(e.gazeY * 0.8);
      block(ox + (2 + gx) * cell, oy + (1 + gy) * cell, cell, cell, pal.pop);
      if (open > 0.5) block(ox + (e.side > 0 ? 3 : 1) * cell, oy, cell, cell, pal.accent);
    }
  });

  // 鼻：三格小 v
  const nx = snap(S.nose.x);
  const ny = snap(S.nose.y);
  block(nx - cell, ny, cell, cell, ink);
  block(nx + cell, ny, cell, cell, ink);
  block(nx, ny + cell, cell, cell, ink);

  // 嘴
  const m = S.mouth;
  const open = clamp01(m.open);
  const mx = snap(m.x + m.shift * cell * 2);
  const my = snap(m.y);
  const wCells = Math.max(2, Math.round(m.w * (1 + 0.3 * m.stretch) / cell));
  const x0 = mx - Math.floor(wCells / 2) * cell;
  if (open > 0.15) {
    const hCells = Math.max(1, Math.round(open * 5));
    for (let i = 0; i < wCells; i++) {
      for (let j = 0; j < hCells; j++) block(x0 + i * cell, my - Math.floor(hCells / 2) * cell + j * cell, cell, cell, '#5d2130');
    }
    if (m.tongue > 0.2) {
      const tRow = my - Math.floor(hCells / 2) * cell + (hCells - 1) * cell;
      for (let i = 1; i < wCells - 1; i++) block(x0 + i * cell, tRow, cell, cell, pal.pop);
    }
  } else {
    const lift = Math.round(m.smile * 2.2 - m.frown * 2.2);
    for (let i = 0; i < wCells; i++) {
      const edge = i === 0 || i === wCells - 1;
      const dy = Math.round(Math.sin((i / Math.max(1, wCells - 1)) * Math.PI) * (m.smile * 2.2 + m.frown * 2.2));
      const y = my + (edge ? -lift : dy);
      block(x0 + i * cell, y, cell, cell, ink);
    }
  }

  // 腮红：2×2 色块
  const blush = clamp01(S.cheek.blush + S.cheek.puff * 0.5);
  if (blush > 0.2) {
    ctx.save();
    ctx.globalAlpha = 0.35 + blush * 0.5;
    for (const s of [-1, 1]) {
      const cxp = snap(S.face.cx + s * S.face.w * 0.4);
      const cyp = snap(S.face.cy + S.face.h * 0.16);
      block(cxp - cell, cyp, cell, cell, '#ff7d9c');
      block(cxp, cyp, cell, cell, '#ff7d9c');
      block(cxp, cyp + cell, cell, cell, '#ff7d9c');
    }
    ctx.restore();
  }

  scanlines(ctx, W, H, pal.dark);

  // 四角取景框
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = Math.max(2, cell * 0.5);
  const pad = cell * 3;
  const L = cell * 4;
  const corners = [
    [pad, pad, 1, 1],
    [W - pad, pad, -1, 1],
    [pad, H - pad, 1, -1],
    [W - pad, H - pad, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * L, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * L);
    ctx.stroke();
  }
  ctx.restore();
}

export const meta = { id: 'pixel', name: '像素' };
