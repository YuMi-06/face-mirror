/**
 * 信号层：把 478 个关键点 + 52 个 blendshape 翻译成「五官状态」。
 * 纯计算，不碰 DOM；输出直接被四个画风消费。
 *
 * 三条原则（都是被实测数据逼出来的）：
 *  1. 位置全部来自关键点 → 转头、点头、前后移动天然跟随，不需要额外解姿态；
 *  2. 所有比例一律用「瞳距」归一化，不用额头—下巴高度：脸贴到画面边缘时
 *     额头关键点会被截断，用脸高会让所有比值一起爆掉；
 *  3. 表情量走自适应基线（每个人静止时的唇缝、眉距、眼睛开度都不同），
 *     blendshape 做语义补充。实测数据见 _tools/probe_metrics.mjs。
 */
import { LM, BS } from './config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: ((p.z || 0) + (q.z || 0)) / 2 });
const avgPts = (pts) => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
};

/** 基线初值：来自官方肖像实测，量级对普通人成立 */
const BASE0 = {
  ear: 0.28, // 眼睛开度（眼睑高 / 眼宽）
  browGap: 0.19, // 眉—上眼睑距离 / 瞳距
  mouthGap: 0.05, // 唇缝 / 瞳距
  mouthLift: 0.0, // 嘴角高于唇心 / 瞳距
};

const EYE_A = LM.eyeA;
const EYE_B = LM.eyeB;

function blankState() {
  const eye = (side) => ({
    x: 0,
    y: 0,
    w: 40,
    h: 22,
    side,
    open: 0.85,
    blink: 0,
    wide: 0,
    squint: 0,
    gazeX: 0,
    gazeY: 0,
    tilt: 0,
    joy: 0,
  });
  return {
    t: 0,
    dt: 1 / 60,
    detected: false,
    presence: 0,
    sleepy: 1,
    face: { cx: 0, cy: 0, w: 120, h: 160, roll: 0, scale: 1, yaw: 0, pitch: 0 },
    eyes: [eye(1), eye(-1)],
    brows: [
      { x: 0, y: 0, w: 44, angle: 0, raise: 0, innerUp: 0, down: 0, side: 1 },
      { x: 0, y: 0, w: 44, angle: 0, raise: 0, innerUp: 0, down: 0, side: -1 },
    ],
    nose: { x: 0, y: 0, w: 20, sneer: 0, wiggle: 0 },
    mouth: {
      x: 0,
      y: 0,
      w: 40,
      open: 0,
      smile: 0,
      frown: 0,
      pucker: 0,
      stretch: 0,
      press: 0,
      shift: 0,
      tongue: 0,
      upperUp: 0,
      lowerDown: 0,
      widthRatio: 0.5,
    },
    cheek: { blush: 0, puff: 0 },
    mood: { joy: 0, surprise: 0, sleepy: 1 },
    view: { W: 0, H: 0, S: 1, faceCx: 0.5, faceCy: 0.5, follow: 1, mirror: true },
    raw: null,
  };
}

export class SignalEngine {
  constructor() {
    this.state = blankState();
    this.sm = new Map();
    this.base = { ear0: BASE0.ear, ear1: BASE0.ear, brow0: BASE0.browGap, brow1: BASE0.browGap, gap: BASE0.mouthGap, lift: BASE0.mouthLift };
    // 一开始就按「没看到脸」起步：页面打开瞬间就能看到中间那副睡着的五官，而不是空白
    this.lostFor = 2;
    this.frame = 0;
  }

  reset() {
    this.sm.clear();
    this.base = { ear0: BASE0.ear, ear1: BASE0.ear, brow0: BASE0.browGap, brow1: BASE0.browGap, gap: BASE0.mouthGap, lift: BASE0.mouthLift };
    this.lostFor = 2;
  }

  /** 指数平滑，可分别给上升 / 下降的时间常数（眨眼要快闭慢睁） */
  smooth(key, target, dt, tauRise = 0.07, tauFall = 0.07) {
    const prev = this.sm.has(key) ? this.sm.get(key) : target;
    if (!Number.isFinite(target)) return Number.isFinite(prev) ? prev : 0;
    const tau = target > prev ? tauRise : tauFall;
    const a = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
    const v = prev + (target - prev) * a;
    this.sm.set(key, v);
    return v;
  }

  /** 漏水极值：快速贴住新极值，缓慢漂回，用来估「这个人眼睛最大能睁多大 / 唇缝最小多小」 */
  leaky(key, v, dt, { min = false, fast = 0.35, slow = 14 } = {}) {
    if (!Number.isFinite(v)) return this.base[key] ?? 0;
    const cur = Number.isFinite(this.base[key]) ? this.base[key] : v;
    const toward = min ? v < cur : v > cur;
    const tau = toward ? fast : slow;
    const next = cur + (v - cur) * (1 - Math.exp(-dt / tau));
    this.base[key] = next;
    return next;
  }

  /**
   * @param {{landmarks:any[],blendshapes:Record<string,number>}|null} raw
   * @param {number} dt 秒
   * @param {{W:number,H:number,zoom:number,follow:number,sensitivity:number}} env
   */
  update(raw, dt, env) {
    const S = this.state;
    const dtc = clamp(dt, 1 / 240, 0.1);
    S.dt = dtc;
    S.t += dtc;
    S.raw = raw;
    const amp = env.sensitivity ?? 1;

    if (!raw) {
      this.lostFor += dtc;
      S.detected = false;
      S.presence = this.smooth('presence', 0, dtc, 0.2, 0.45);
      S.sleepy = smoothstep(0.35, 1.4, this.lostFor);
      this.applyIdle(S, S.sleepy, dtc, env);
      S.mood.joy = this.smooth('joy', 0, dtc, 0.2, 0.3);
      S.mood.surprise = this.smooth('surprise', 0, dtc, 0.2, 0.3);
      return S;
    }

    this.lostFor = 0;
    S.detected = true;
    S.presence = this.smooth('presence', 1, dtc, 0.12, 0.2);
    S.sleepy = this.smooth('sleepy', 0, dtc, 0.12, 0.2);
    // 醒着的时候必须把「睡着」进度清零，否则 z z z 会一直挂着
    S.mood.sleepy = this.smooth('sleepyMood', 0, dtc, 0.2, 0.25);

    const P = raw.landmarks;
    const bs = raw.blendshapes || {};
    const b = (name) => bs[name] || 0;

    // ---- 画面映射 --------------------------------------------------------
    const W = env.W;
    const H = env.H;
    const scalePx = Math.min(W, H) * env.zoom;
    // 关键点坐标是按画面宽高各自归一化的，x/y 不是同一尺度；
    // 用 aspect = 视频高/宽 把 y 轴换算成各向同性，否则脸会被纵向拉伸。
    const aspect = env.aspect || 0.75;
    const scalePy = scalePx * aspect;
    const follow = env.follow;

    const faceTop = P[LM.face.top];
    const faceChin = P[LM.face.chin];
    const faceA = P[LM.face.sideA];
    const faceB = P[LM.face.sideB];
    const faceH = Math.max(dist(faceTop, faceChin), 1e-4);
    const faceW = Math.max(Math.abs(faceA.x - faceB.x), 1e-4);

    const cA = mid(P[EYE_A.outer], P[EYE_A.inner]);
    const cB = mid(P[EYE_B.outer], P[EYE_B.inner]);
    /** 瞳距：所有表情比例都拿它当尺子 */
    const interEye = Math.max(dist(cA, cB), 1e-4);

    // 镜像 + 居中：脸心偏离画面中心的那部分位移按 follow 缩放，五官之间的相对形状不变
    const rawFaceCx = 1 - (faceA.x + faceB.x) / 2;
    const rawFaceCy = (faceTop.y + faceChin.y) / 2;
    let offX = (rawFaceCx - 0.5) * scalePx * follow;
    let offY = (rawFaceCy - 0.5) * scalePy * follow;
    // 软限位：整组五官不许滑出画面（脸贴边时仍然看得见）
    const homeX = W / 2 + offX;
    const homeY = H / 2 + offY;
    const marginX = W * 0.16;
    const marginY = H * 0.18;
    offX += clamp(homeX, marginX, W - marginX) - homeX;
    offY += clamp(homeY, marginY, H - marginY) - homeY;

    const px = (n) => W / 2 + (1 - n - rawFaceCx) * scalePx + offX;
    const py = (n) => H / 2 + (n - rawFaceCy) * scalePy + offY;
    const metric = (d) => d * scalePx;
    const metricY = (d) => d * scalePy;

    S.view = { W, H, S: scalePx, Sy: scalePy, offX, offY, aspect, faceCx: rawFaceCx, faceCy: rawFaceCy, follow, mirror: true };

    const roll = Math.atan2(py(cB.y) - py(cA.y), px(cB.x) - px(cA.x));

    // ---- 眼 --------------------------------------------------------------
    const makeEye = (i, cfg, center, blinkName, wideName, squintName, side) => {
      const cornerW = Math.max(dist(P[cfg.outer], P[cfg.inner]), 1e-5);
      const hRaw = dist(P[cfg.upper], P[cfg.lower]);
      const ear = hRaw / cornerW;
      // 自适应开度基线：取近期最大开度，眯眼 / 亚洲眼型也能正确判「睁着」
      const baseEar = this.leaky(`ear${i}`, ear, dtc, { fast: 0.25, slow: 20 });
      let openGeo = smoothstep(baseEar * 0.4, baseEar * 0.86, ear);
      const blinkBs = b(blinkName);
      let blink = clamp01(1 - openGeo);
      if (blinkBs > 0.45 && openGeo > 0.55) blink = Math.max(blink, blinkBs * 0.7);
      blink = clamp01((blink - 0.02) / 0.9);
      const blinkSm = this.smooth(`blink${i}`, blink, dtc, 0.022, 0.085);
      const wide = b(wideName);
      const open = clamp(1 - blinkSm, 0, 1) * (1 + 0.35 * wide);

      // 瞳孔：虹膜相对眼眶中心的位移，用固定增益放大；闭眼时归零防抖
      let gazeX = 0;
      let gazeY = 0;
      const iris = P[cfg.iris];
      if (iris) {
        gazeX = clamp((-(iris.x - center.x) / cornerW) * 3.2, -1, 1) * openGeo;
        gazeY = clamp((((iris.y - center.y) * aspect) / cornerW) * 3.0, -1, 1) * openGeo;
      }
      const e = S.eyes[i];
      e.x = this.smooth(`ex${i}`, px(center.x), dtc, 0.05, 0.05);
      e.y = this.smooth(`ey${i}`, py(center.y), dtc, 0.05, 0.05);
      e.w = this.smooth(`ew${i}`, metric(cornerW), dtc, 0.08, 0.08);
      e.h = this.smooth(`eh${i}`, metricY(hRaw), dtc, 0.08, 0.08);
      e.open = this.smooth(`eo${i}`, open, dtc, 0.035, 0.09);
      e.blink = this.smooth(`eb${i}`, blinkSm, dtc, 0.035, 0.09);
      e.wide = this.smooth(`ewd${i}`, wide, dtc, 0.08, 0.08);
      e.squint = this.smooth(`esq${i}`, b(squintName), dtc, 0.08, 0.08);
      e.gazeX = this.smooth(`egx${i}`, gazeX * amp, dtc, 0.06, 0.06);
      e.gazeY = this.smooth(`egy${i}`, gazeY * amp, dtc, 0.06, 0.06);
      e.tilt = this.smooth('roll', roll, dtc, 0.07, 0.07);
      e.side = side;
      return e;
    };
    makeEye(0, EYE_A, cA, BS.blinkA, BS.wideA, BS.squintA, 1);
    makeEye(1, EYE_B, cB, BS.blinkB, BS.wideB, BS.squintB, -1);

    // ---- 眉 --------------------------------------------------------------
    const calm = clamp01(
      1 -
        Math.max(
          b(BS.browInnerUp) * 3,
          b(BS.browOuterUpA) * 3,
          b(BS.browOuterUpB) * 3,
          b(BS.browDownA) * 2,
          b(BS.browDownB) * 2,
          S.eyes[0].blink,
          S.eyes[1].blink
        )
    );
    const makeBrow = (i, idx, eyeCfg, outerUp, downN, side) => {
      const pts = idx.map((k) => P[k]);
      const anchor = avgPts(pts);
      const gapIE = ((P[eyeCfg.upper].y - anchor.y) * aspect) / interEye;
      const base = this.base[`brow${i}`];
      if (calm > 0.55) this.base[`brow${i}`] = base + (gapIE - base) * (1 - Math.exp(-dtc / 2.5));
      const raiseGeo = clamp((gapIE - this.base[`brow${i}`]) / 0.05, -1.1, 1.5);
      const down = b(downN);
      const raiseBs = clamp(b(outerUp) * 1.15 + b(BS.browInnerUp) * 0.55 - down * 0.75, -0.9, 1.5);
      const raise = clamp((raiseGeo * 0.7 + raiseBs * 0.7) * amp, -1.2, 1.6);
      const left = P[idx[0]];
      const right = P[idx[idx.length - 1]];
      const br = S.brows[i];
      br.x = this.smooth(`bx${i}`, px(anchor.x), dtc, 0.06, 0.06);
      br.y = this.smooth(`by${i}`, py(anchor.y), dtc, 0.055, 0.09);
      br.w = this.smooth(`bw${i}`, metric(dist(left, right)), dtc, 0.08, 0.08);
      br.angle = this.smooth(`ba${i}`, Math.atan2(py(right.y) - py(left.y), px(right.x) - px(left.x)), dtc, 0.08, 0.08);
      br.raise = this.smooth(`br${i}`, raise, dtc, 0.06, 0.09);
      br.innerUp = this.smooth(`bi${i}`, b(BS.browInnerUp), dtc, 0.07, 0.09);
      br.down = this.smooth(`bd${i}`, down, dtc, 0.07, 0.09);
      br.side = side;
      return br;
    };
    makeBrow(0, LM.browA, EYE_A, BS.browOuterUpA, BS.browDownA, 1);
    makeBrow(1, LM.browB, EYE_B, BS.browOuterUpB, BS.browDownB, -1);

    // ---- 鼻 --------------------------------------------------------------
    const noseTip = P[LM.nose.tip];
    const noseAnchor = mid(noseTip, P[LM.nose.bottom]);
    const noseY = py(noseAnchor.y);
    S.nose.y = this.smooth('ny', noseY, dtc, 0.06, 0.06);
    S.nose.x = this.smooth('nx', px(noseAnchor.x), dtc, 0.06, 0.06);
    S.nose.w = this.smooth('nw', metric(dist(P[LM.nose.left], P[LM.nose.right])), dtc, 0.1, 0.1);
    S.nose.sneer = this.smooth('ns', clamp01((b(BS.sneerA) + b(BS.sneerB)) * 0.5 * 1.6), dtc, 0.07, 0.07);
    S.nose.wiggle = this.smooth('nwg', clamp01(Math.abs(noseY - S.nose.y) / (scalePx * 0.01)), dtc, 0.05, 0.12);

    // ---- 嘴 --------------------------------------------------------------
    const mUp = P[LM.mouth.upper];
    const mLow = P[LM.mouth.lower];
    const mLeft = P[LM.mouth.left];
    const mRight = P[LM.mouth.right];
    const mCenter = mid(mUp, mLow);
    const gapIE = ((mLow.y - mUp.y) * aspect) / interEye;
    const baseGap = this.leaky('gap', gapIE, dtc, { min: true, fast: 0.5, slow: 10 });
    const openGeo = smoothstep(baseGap + 0.12, baseGap + 0.45, gapIE);
    const jaw = smoothstep(0.25, 0.8, b(BS.jawOpen));
    const open = clamp01(Math.max(openGeo, jaw) * (1 + 0.1 * b(BS.jawForward)));

    const cornerLift = (((mCenter.y - (mLeft.y + mRight.y) / 2) * aspect) / interEye) * (1 - open * 0.75);
    const smileBs = (b(BS.smileA) + b(BS.smileB)) * 0.5;
    if (calm > 0.5 && smileBs < 0.2 && open < 0.25) {
      this.base.lift += (cornerLift - this.base.lift) * (1 - Math.exp(-dtc / 3.5));
    }
    const smileGeo = smoothstep(this.base.lift + 0.03, this.base.lift + 0.11, cornerLift);
    const smile = clamp01(Math.max(smileGeo, smoothstep(0.2, 0.85, smileBs)) * amp);
    const frown = clamp01(
      Math.max(
        smoothstep(0.03, 0.12, this.base.lift - cornerLift),
        smoothstep(0.2, 0.8, (b(BS.frownA) + b(BS.frownB)) * 0.5)
      )
    );

    const m = S.mouth;
    m.x = this.smooth('mx', px(mCenter.x), dtc, 0.055, 0.055);
    m.y = this.smooth('my', py(mCenter.y), dtc, 0.055, 0.055);
    m.w = this.smooth('mw', metric(dist(mLeft, mRight)), dtc, 0.07, 0.07);
    m.open = this.smooth('mo', open, dtc, 0.05, 0.09);
    m.smile = this.smooth('msm', smile, dtc, 0.07, 0.09);
    m.frown = this.smooth('mfr', frown, dtc, 0.07, 0.09);
    m.pucker = this.smooth('mpu', clamp01(b(BS.pucker) * 1.6), dtc, 0.07, 0.09);
    m.stretch = this.smooth('mst', clamp01(((b(BS.stretchA) + b(BS.stretchB)) * 0.5) * 1.4), dtc, 0.07, 0.09);
    m.press = this.smooth('mpr', clamp01(((b(BS.pressA) + b(BS.pressB)) * 0.5) * 1.5), dtc, 0.07, 0.09);
    m.shift = this.smooth('msh', clamp((b(BS.shiftR) - b(BS.shiftL)) * 1.2 * amp, -1, 1), dtc, 0.07, 0.09);
    m.tongue = this.smooth('mtg', clamp01(b(BS.tongue) * 1.8), dtc, 0.06, 0.08);
    m.upperUp = this.smooth('muu', clamp01(((b(BS.upperUpA) + b(BS.upperUpB)) * 0.5) * 1.4), dtc, 0.07, 0.09);
    m.lowerDown = this.smooth('mld', clamp01(((b(BS.lowerDownA) + b(BS.lowerDownB)) * 0.5) * 1.4), dtc, 0.07, 0.09);
    m.widthRatio = this.smooth('mwr', dist(mLeft, mRight) / faceW, dtc, 0.1, 0.1);

    // ---- 面颊 / 情绪 ------------------------------------------------------
    const blushRaw = clamp01(
      Math.max(smile * 1.15, b(BS.cheekSquintA), b(BS.cheekSquintB), ((b(BS.dimpleA) + b(BS.dimpleB)) * 0.5) * 1.3)
    );
    S.cheek.blush = this.smooth('blush', blushRaw * amp, dtc, 0.08, 0.12);
    S.cheek.puff = this.smooth('puff', clamp01(b(BS.cheekPuff) * 1.8), dtc, 0.08, 0.12);
    S.mood.joy = this.smooth('joy', clamp01(Math.max(smile, (b(BS.cheekSquintA) + b(BS.cheekSquintB)) * 0.5) * 1.25), dtc, 0.07, 0.12);
    S.mood.surprise = this.smooth(
      'surprise',
      clamp01(Math.max(b(BS.wideA), b(BS.wideB)) * 1.3) * smoothstep(0.15, 0.55, open),
      dtc,
      0.06,
      0.12
    );

    // ---- 脸整体 ----------------------------------------------------------
    // 脸心在画布上的位置就是「画面中心 + 偏移」（偏移已按 follow 缩放并做过软限位）。
    // ⚠️ 不能再喂 px(rawFaceCx)：rawFaceCx 已经是镜像后的值，px 里的 (1 - n) 会把它反第二次，
    //    于是脸框/腮红/光环/点击区域会跑到别人的位置上（Y 轴不镜像，所以一直没露馅）。
    S.face.cx = this.smooth('fcx', W / 2 + offX, dtc, 0.07, 0.07);
    S.face.cy = this.smooth('fcy', H / 2 + offY, dtc, 0.07, 0.07);
    S.face.w = this.smooth('fw', metric(faceW), dtc, 0.1, 0.1);
    S.face.h = this.smooth('fh', metricY(faceH), dtc, 0.1, 0.1);
    S.face.roll = this.smooth('roll2', roll, dtc, 0.07, 0.07);
    S.face.scale = S.face.w;
    S.face.yaw = this.smooth('yaw', clamp(((1 - noseTip.x) - rawFaceCx) / (faceW / 2), -1.2, 1.2), dtc, 0.08, 0.08);
    S.face.pitch = this.smooth(
      'pitch',
      clamp(((noseAnchor.y - (faceTop.y + faceChin.y) / 2) / faceH) * 3.2, -1.2, 1.2),
      dtc,
      0.08,
      0.08
    );

    this.frame += 1;
    return S;
  }

  /** 没脸（或刚失去）时的「睡着」姿态 */
  applyIdle(S, k, dt, env) {
    if (k <= 0.001) return;
    const cx = env.W / 2;
    const cy = env.H / 2;
    const unit = Math.min(env.W, env.H) * 0.12;
    const e = 0.12 + 0.88 * k;
    for (let i = 0; i < 2; i++) {
      const eye = S.eyes[i];
      const side = eye.side;
      const tx = cx + side * unit * 0.75;
      const ty = cy - unit * 0.25;
      eye.x = lerp(eye.x, this.smooth(`idlex${i}`, tx, dt, 0.5, 0.5), e);
      eye.y = lerp(eye.y, this.smooth(`idley${i}`, ty, dt, 0.5, 0.5), e);
      eye.w = lerp(eye.w, this.smooth('idlew', unit * 0.95, dt, 0.5, 0.5), e);
      eye.h = lerp(eye.h, this.smooth('idleh', unit * 0.5, dt, 0.5, 0.5), e);
      eye.open = lerp(eye.open, this.smooth(`idleo${i}`, 0.06 + 0.02 * Math.sin(S.t * 1.6 + i), dt, 0.6, 0.6), e);
      eye.blink = lerp(eye.blink, this.smooth(`idleb${i}`, 0.94, dt, 0.6, 0.6), e);
      eye.gazeX = lerp(eye.gazeX, 0, e);
      eye.gazeY = lerp(eye.gazeY, 0.1, e);
      eye.tilt = lerp(eye.tilt, 0, e);
      eye.joy = 0;
      const br = S.brows[i];
      br.x = lerp(br.x, eye.x, e);
      br.y = lerp(br.y, this.smooth(`idleby${i}`, ty - unit * 0.78, dt, 0.5, 0.5), e);
      br.w = lerp(br.w, this.smooth('idlebw', unit * 1.0, dt, 0.5, 0.5), e);
      br.angle = lerp(br.angle, side * 0.06, e);
      br.raise = lerp(br.raise, 0, e);
      br.innerUp = lerp(br.innerUp, 0.1, e);
      br.down = lerp(br.down, 0.05, e);
    }
    S.nose.x = lerp(S.nose.x, this.smooth('idlenx', cx, dt, 0.5, 0.5), e);
    S.nose.y = lerp(S.nose.y, this.smooth('idleny', cy + unit * 0.28, dt, 0.5, 0.5), e);
    S.nose.w = lerp(S.nose.w, this.smooth('idlenw', unit * 0.4, dt, 0.5, 0.5), e);
    S.nose.sneer = lerp(S.nose.sneer, 0, e);
    S.nose.wiggle = lerp(S.nose.wiggle, 0, e);
    const m = S.mouth;
    m.x = lerp(m.x, this.smooth('idlemx', cx, dt, 0.5, 0.5), e);
    m.y = lerp(m.y, this.smooth('idlemy', cy + unit * 1.05, dt, 0.5, 0.5), e);
    m.w = lerp(m.w, this.smooth('idlemw', unit * 0.9, dt, 0.5, 0.5), e);
    m.open = lerp(m.open, this.smooth('idlemo', 0.1, dt, 0.6, 0.6), e);
    m.smile = lerp(m.smile, 0, e);
    m.frown = lerp(m.frown, 0, e);
    m.pucker = lerp(m.pucker, 0, e);
    m.stretch = lerp(m.stretch, 0, e);
    m.press = lerp(m.press, 0.1, e);
    m.shift = lerp(m.shift, 0, e);
    m.tongue = lerp(m.tongue, 0, e);
    m.upperUp = lerp(m.upperUp, 0, e);
    m.lowerDown = lerp(m.lowerDown, 0, e);
    S.cheek.blush = lerp(S.cheek.blush, 0, e);
    S.cheek.puff = lerp(S.cheek.puff, 0, e);
    S.face.cx = lerp(S.face.cx, cx, e);
    S.face.cy = lerp(S.face.cy, cy, e);
    S.face.w = lerp(S.face.w, unit * 2.4, e);
    S.face.h = lerp(S.face.h, unit * 3, e);
    S.face.roll = lerp(S.face.roll, 0, e);
    S.face.yaw = lerp(S.face.yaw, 0, e);
    S.face.pitch = lerp(S.face.pitch, 0, e);
    S.mood.sleepy = this.smooth('sleepyMood', k, dt, 0.6, 0.6);
  }
}

export { clamp, clamp01, lerp, smoothstep };
