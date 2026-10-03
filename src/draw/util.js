/**
 * 绘图工具：路径 / 曲线采样 / 笔触 / 伪随机 / 纸纹。
 * 四个画风共用，尽量保持无状态（纹理走缓存）。
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** mulberry32：小而稳的伪随机，用于让「手绘」边缘每帧一致 */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(Math.abs(rx), 0.01), Math.max(Math.abs(ry), 0.01), rot, 0, Math.PI * 2);
}

/** 不规则闭合「墨点」 */
export function blob(ctx, x, y, rx, ry, seed, wob = 0.14, rot = 0) {
  const r = rng(seed);
  const n = 14;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (r() - 0.5) * 2 * wob;
    const px = Math.cos(a) * rx * k;
    const py = Math.sin(a) * ry * k;
    const cx = x + px * Math.cos(rot) - py * Math.sin(rot);
    const cy = y + px * Math.sin(rot) + py * Math.cos(rot);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.closePath();
}

export function sampleQuad(p0, p1, p2, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

export function sampleCubic(p0, p1, p2, p3, n = 28) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** 沿折线画变宽笔触（毛笔 / 手绘感） */
export function strokePath(ctx, pts, { width = () => 4, color = '#000', alpha = 1, seed = 1, wobble = 0 } = {}) {
  if (pts.length < 2) return;
  const r = rng(seed);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const last = pts.length - 1;
  for (let i = 0; i < last; i++) {
    const t = (i + 0.5) / last;
    const w = Math.max(width(t), 0.4);
    const jx = wobble ? (r() - 0.5) * wobble : 0;
    const jy = wobble ? (r() - 0.5) * wobble : 0;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[i].x + jx, pts[i].y + jy);
    ctx.lineTo(pts[i + 1].x + jx, pts[i + 1].y + jy);
    ctx.stroke();
  }
  ctx.restore();
}

/** 四角星闪光 */
export function sparkle(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.32;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const textureCache = new Map();

/** 纸纹 / 噪点纹理，按尺寸与种子缓存 */
export function noiseTexture(W, H, { seed = 7, dots = 2600, alpha = 0.05, color = '#000', size = 1.4 } = {}) {
  const key = `${W}x${H}:${seed}:${dots}:${color}:${size}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.floor(W));
  cv.height = Math.max(1, Math.floor(H));
  const c = cv.getContext('2d');
  const r = rng(seed);
  c.fillStyle = color;
  for (let i = 0; i < dots; i++) {
    c.globalAlpha = alpha * (0.35 + r() * 0.9);
    const s = size * (0.5 + r());
    c.fillRect(r() * W, r() * H, s, s);
  }
  textureCache.set(key, cv);
  return cv;
}

/** 睡着时的 z z z（所有画风共用） */
export function drawSleepZs(ctx, S, pal, t) {
  const k = S.mood.sleepy;
  if (k < 0.05) return;
  const baseX = S.face.cx + S.face.w * 0.55;
  const baseY = S.face.cy - S.face.h * 0.35;
  const unit = Math.max(12, S.face.w * 0.16);
  ctx.save();
  ctx.fillStyle = pal.ink;
  ctx.font = `700 ${Math.round(unit)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    const p = ((t * 0.35 + i * 0.33) % 1);
    const rise = p * unit * 3.2;
    const a = Math.sin(p * Math.PI) * k;
    ctx.globalAlpha = a * 0.85;
    const size = 0.6 + p * 0.8;
    ctx.font = `700 ${Math.round(unit * size)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText('z', baseX + Math.sin(p * 4 + i) * unit * 0.35, baseY - rise);
  }
  ctx.restore();
}
