/**
 * 全局配置：关键点索引、blendshape 名称、配色、风格表。
 * 这一层不碰 DOM，改动只影响数值与选项。
 */

/** MediaPipe FaceMesh 关键点索引（478 点，含虹膜） */
export const LM = {
  // 人物右眼（画面左侧那一只）
  eyeA: { outer: 33, inner: 133, upper: 159, lower: 145, lidTop: 158, iris: 468 },
  // 人物左眼（画面右侧那一只）
  eyeB: { outer: 263, inner: 362, upper: 386, lower: 374, lidTop: 385, iris: 473 },
  browA: [70, 63, 105, 66, 107], // 人物右眉
  browB: [300, 293, 334, 296, 336], // 人物左眉
  nose: { tip: 1, bottom: 2, left: 129, right: 358, bridge: 6 },
  mouth: {
    upper: 13,
    lower: 14,
    left: 61,
    right: 291,
    upperOuter: 0,
    lowerOuter: 17,
    innerLeft: 78,
    innerRight: 308,
  },
  face: { top: 10, chin: 152, sideA: 234, sideB: 454 },
};

/**
 * blendshape 名 → 语义。Left/Right 按 ARKit 惯例指人物自身左右：
 * eyeBlinkLeft 对应人物左眼（画面右侧，即 LM.eyeB）。
 */
export const BS = {
  blinkA: 'eyeBlinkRight',
  blinkB: 'eyeBlinkLeft',
  squintA: 'eyeSquintRight',
  squintB: 'eyeSquintLeft',
  wideA: 'eyeWideRight',
  wideB: 'eyeWideLeft',
  lookUpA: 'eyeLookUpRight',
  lookUpB: 'eyeLookUpLeft',
  lookDownA: 'eyeLookDownRight',
  lookDownB: 'eyeLookDownLeft',
  lookInA: 'eyeLookInRight',
  lookInB: 'eyeLookInLeft',
  lookOutA: 'eyeLookOutRight',
  lookOutB: 'eyeLookOutLeft',
  browInnerUp: 'browInnerUp',
  browOuterUpA: 'browOuterUpRight',
  browOuterUpB: 'browOuterUpLeft',
  browDownA: 'browDownRight',
  browDownB: 'browDownLeft',
  smileA: 'mouthSmileRight',
  smileB: 'mouthSmileLeft',
  frownA: 'mouthFrownRight',
  frownB: 'mouthFrownLeft',
  dimpleA: 'mouthDimpleRight',
  dimpleB: 'mouthDimpleLeft',
  pucker: 'mouthPucker',
  funnel: 'mouthFunnel',
  jawOpen: 'jawOpen',
  mouthClose: 'mouthClose',
  upperUpA: 'mouthUpperUpRight',
  upperUpB: 'mouthUpperUpLeft',
  lowerDownA: 'mouthLowerDownRight',
  lowerDownB: 'mouthLowerDownLeft',
  stretchA: 'mouthStretchRight',
  stretchB: 'mouthStretchLeft',
  pressA: 'mouthPressRight',
  pressB: 'mouthPressLeft',
  shiftL: 'mouthLeft',
  shiftR: 'mouthRight',
  tongue: 'tongueOut',
  cheekPuff: 'cheekPuff',
  cheekSquintA: 'cheekSquintRight',
  cheekSquintB: 'cheekSquintLeft',
  sneerA: 'noseSneerRight',
  sneerB: 'noseSneerLeft',
};

/** 配色。dark 决定描边用亮色还是暗色 */
export const PALETTES = {
  peach: {
    name: '蜜桃',
    bg: '#fff4ee',
    bg2: '#ffe6d8',
    ink: '#2f2018',
    accent: '#ff8a5c',
    soft: '#ffd6c2',
    pop: '#ff5d7a',
    dark: false,
  },
  mint: {
    name: '薄荷',
    bg: '#eefaf4',
    bg2: '#d8f3e8',
    ink: '#123029',
    accent: '#31c39d',
    soft: '#bdeddc',
    pop: '#ff9f68',
    dark: false,
  },
  galaxy: {
    name: '银河',
    bg: '#111129',
    bg2: '#1e1e46',
    ink: '#efeaff',
    accent: '#8b7bff',
    soft: '#33335f',
    pop: '#ffd166',
    dark: true,
  },
  candy: {
    name: '糖果',
    bg: '#fff0f7',
    bg2: '#ffe0ee',
    ink: '#3a1f2b',
    accent: '#ff6fa5',
    soft: '#ffd0e2',
    pop: '#79d2ff',
    dark: false,
  },
  ink: {
    name: '宣纸',
    bg: '#f7f3e8',
    bg2: '#efe8d6',
    ink: '#1c1a17',
    accent: '#9a2b23',
    soft: '#ded5bf',
    pop: '#c8a24a',
    dark: false,
  },
};

export const STYLES = [
  { id: 'kawaii', name: '可爱', hint: '大眼睛 + 腮红 + 猫嘴' },
  { id: 'abstract', name: '抽象', hint: '几何块面，包豪斯式五官' },
  { id: 'pixel', name: '像素', hint: '8-bit 方块五官' },
  { id: 'ink', name: '水墨', hint: '毛笔线 + 墨点' },
];

export const DEFAULT_SETTINGS = {
  style: 'kawaii',
  palette: 'peach',
  zoom: 1.35,
  follow: 1, // 0 = 五官固定居中，1 = 完全跟随头部位移
  sensitivity: 1,
  view: 'pip', // off | pip | debug
  showHint: true,
  autoPrompt: true, // 有人坐到摄像头前 → 自动弹出画风选择
};

/** 离开画面多久之后再出现，算「换了一个人」，重新弹一次画风选择 */
export const NEW_FACE_ABSENCE_SEC = 5;

/** 画面里超过这么多人时，新来的不再自动弹画风选择（会互相打断），改为提示按 C 自选 */
export const CHOOSER_AUTO_MAX_PEOPLE = 3;

/** 同时最多跟几张脸（要改的话同时改 track.js 里的 numFaces） */
export const MAX_FACES = 8;

export const VIDEO_CONSTRAINTS = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30, max: 60 },
  facingMode: 'user',
};
