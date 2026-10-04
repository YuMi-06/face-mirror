/**
 * 主程序：摄像头 → 关键点 → 五官状态 → 画布，以及全部界面逻辑。
 * 离线运行：模型与 wasm 都来自 ../vendor。
 */
import { PALETTES, STYLES, DEFAULT_SETTINGS, VIDEO_CONSTRAINTS, NEW_FACE_ABSENCE_SEC, CHOOSER_AUTO_MAX_PEOPLE, MAX_FACES } from './config.js';
import { FaceTracker } from './track.js';
import { SignalEngine } from './signals.js';
import { render } from './draw/index.js';
import { clamp } from './draw/util.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'face-mirror.settings.v1';

/** 载入耗时打点：单文件版的 17 MB 到底慢在哪，用数据说话 */
const T = (window.__fmTimings = window.__fmTimings || {});
T.payload = window.__fmPayloadAt || null; // 内联资源脚本执行完的时刻（单文件版才有）
T.main = performance.now();

const el = {
  canvas: $('view'),
  video: $('cam'),
  panel: $('panel'),
  boot: $('boot'),
  bootMsg: $('bootMsg'),
  fatal: $('fatal'),
  fatalTitle: $('fatalTitle'),
  fatalMsg: $('fatalMsg'),
  fatalHint: $('fatalHint'),
  fatalRetry: $('fatalRetry'),
  statusText: $('statusText'),
  statusSub: $('statusSub'),
  dot: $('dot'),
  hint: $('hint'),
  toast: $('toast'),
  camSelect: $('camSelect'),
  styleSeg: $('styleSeg'),
  paletteDots: $('paletteDots'),
  viewSeg: $('viewSeg'),
  zoom: $('zoom'),
  follow: $('follow'),
  sens: $('sens'),
  zoomVal: $('zoomVal'),
  followVal: $('followVal'),
  sensVal: $('sensVal'),
  promptSeg: $('promptSeg'),
  pickStyle: $('pickStyle'),
  chooser: $('chooser'),
  chooserTitle: $('chooserTitle'),
  chooserSkip: $('chooserSkip'),
  styleTiles: $('styleTiles'),
};

const ctx = el.canvas.getContext('2d', { alpha: false });

const app = {
  settings: { ...DEFAULT_SETTINGS },
  tracker: null,
  engine: new SignalEngine(), // 兼容字段：真正的人脸状态在 people 里（一人一套）
  state: null,
  stream: null,
  devices: [],
  deviceId: null,
  running: false,
  starting: false,
  modelReady: false,
  cameraError: null,
  fps: 0,
  lastVideoTime: -1,
  lastFaces: [],
  override: null,
  dpr: 1,
  W: 0,
  H: 0,
  /** 多人：一人一套会话（状态机 + 画风），见 createPerson / trackPeople */
  people: [],
  activeId: null,
  nextPersonId: 1,
  peopleOnScreen: 0,
};

/** 画风选择的弹出状态：谁坐到摄像头前，就给谁弹一次 */
const ui = {
  present: false,
  presentSec: 0,
  absentSec: 0,
  absentBefore: 0,
  appearance: 0,
  promptedAppearance: 0,
  open: false,
  lastPreview: 0,
  tiles: [],
};

// ---------------------------------------------------------------- 设置持久化
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) Object.assign(app.settings, JSON.parse(raw));
  } catch {
    /* 忽略损坏的设置 */
  }
  if (!PALETTES[app.settings.palette]) app.settings.palette = DEFAULT_SETTINGS.palette;
  if (!STYLES.some((s) => s.id === app.settings.style)) app.settings.style = DEFAULT_SETTINGS.style;
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(app.settings));
  } catch {
    /* 隐私模式下可能不可写 */
  }
}

// ---------------------------------------------------------------- 界面
function buildUi() {
  el.styleSeg.innerHTML = '';
  for (const s of STYLES) {
    const b = document.createElement('button');
    b.textContent = s.name;
    b.title = s.hint;
    b.dataset.id = s.id;
    b.onclick = () => setStyle(s.id);
    el.styleSeg.appendChild(b);
  }
  el.paletteDots.innerHTML = '';
  for (const [id, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button');
    b.title = p.name;
    b.dataset.id = id;
    b.innerHTML = `<i style="background:${p.bg}"></i><i style="background:${p.accent}"></i>`;
    b.onclick = () => setPalette(id);
    el.paletteDots.appendChild(b);
  }
  el.viewSeg.innerHTML = '';
  for (const [id, name] of [['off', '关'], ['pip', '小窗'], ['debug', '调试']]) {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.id = id;
    b.onclick = () => setView(id);
    el.viewSeg.appendChild(b);
  }
  el.promptSeg.innerHTML = '';
  for (const [id, name] of [['on', '弹出画风选择'], ['off', '不弹']]) {
    const b = document.createElement('button');
    b.textContent = name;
    b.dataset.id = id;
    b.onclick = () => {
      app.settings.autoPrompt = id === 'on';
      syncUi();
      saveSettings();
      toast(app.settings.autoPrompt ? '下次有人坐到前面会弹出画风选择' : '不再自动弹出，可用「换画风」手动打开');
    };
    el.promptSeg.appendChild(b);
  }
  buildChooser();
  el.zoom.oninput = () => {
    app.settings.zoom = parseFloat(el.zoom.value);
    syncLabels();
    saveSettings();
  };
  el.follow.oninput = () => {
    app.settings.follow = parseFloat(el.follow.value);
    syncLabels();
    saveSettings();
  };
  el.sens.oninput = () => {
    app.settings.sensitivity = parseFloat(el.sens.value);
    syncLabels();
    saveSettings();
  };
  el.camSelect.onchange = () => {
    app.deviceId = el.camSelect.value;
    startCamera(app.deviceId).catch(reportCameraError);
  };
  $('shot').onclick = () => snapshot();
  el.pickStyle.onclick = () => openChooser('manual');
  el.chooserSkip.onclick = () => closeChooser('skip');
  el.chooser.addEventListener('click', (e) => {
    if (e.target === el.chooser) closeChooser('backdrop');
  });
  $('reset').onclick = () => {
    app.settings = { ...DEFAULT_SETTINGS };
    syncUi();
    saveSettings();
    toast('已恢复默认设置');
  };
  $('collapse').onclick = () => el.panel.classList.toggle('collapsed');
  el.fatalRetry.onclick = () => location.reload();
  syncUi();
}

function syncUi() {
  const s = app.settings;
  for (const b of el.styleSeg.children) b.classList.toggle('active', b.dataset.id === s.style);
  for (const b of el.paletteDots.children) b.classList.toggle('active', b.dataset.id === s.palette);
  for (const b of el.viewSeg.children) b.classList.toggle('active', b.dataset.id === s.view);
  for (const b of el.promptSeg.children) b.classList.toggle('active', (b.dataset.id === 'on') === !!s.autoPrompt);
  if (ui.tiles.length) markActiveTile();
  el.zoom.value = s.zoom;
  el.follow.value = s.follow;
  el.sens.value = s.sensitivity;
  syncLabels();
}

function syncLabels() {
  el.zoomVal.textContent = `${app.settings.zoom.toFixed(2)}×`;
  el.followVal.textContent = `${Math.round(app.settings.follow * 100)}%`;
  el.sensVal.textContent = `${Math.round(app.settings.sensitivity * 100)}%`;
}

function setStyle(id) {
  app.settings.style = id;
  const p = activePerson(); // 画风记在当前这个人身上：多人同框时各用各的
  if (p) p.style = id;
  syncUi();
  saveSettings();
  const s = STYLES.find((x) => x.id === id);
  if (s) toast(`${s.name} · ${s.hint}`);
}

function setPalette(id) {
  app.settings.palette = id;
  const p = activePerson();
  if (p) p.palette = id;
  syncUi();
  saveSettings();
}

function setView(id) {
  app.settings.view = id;
  syncUi();
  saveSettings();
}

// ------------------------------------------------- 画风选择（谁在面前就给谁弹）
function buildChooser() {
  el.styleTiles.innerHTML = '';
  ui.tiles = [];
  for (const s of STYLES) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.dataset.id = s.id;
    const cv = document.createElement('canvas');
    const label = document.createElement('b');
    label.textContent = s.name;
    const hint = document.createElement('span');
    hint.textContent = s.hint;
    b.append(cv, label, hint);
    b.onclick = () => {
      setStyle(s.id);
      closeChooser('picked');
    };
    el.styleTiles.appendChild(b);
    ui.tiles.push({ id: s.id, el: b, canvas: cv });
  }
}

function markActiveTile() {
  for (const t of ui.tiles) t.el.classList.toggle('active', t.id === app.settings.style);
}

function openChooser(reason) {
  if (ui.open) return;
  ui.open = true;
  ui.promptedAppearance = ui.appearance;
  el.chooserTitle.textContent = ui.appearance > 1 ? '又来了一位，选个画风吧' : '你好，选一个画风吧';
  el.chooser.hidden = false;
  markActiveTile();
  sizePreviewCanvases();
  drawPreviews();
}

function closeChooser(reason) {
  if (!ui.open) return;
  ui.open = false;
  el.chooser.hidden = true;
  if (reason === 'skip') toast('保持现在的画风');
}

function sizePreviewCanvases() {
  const dpr = app.dpr;
  for (const t of ui.tiles) {
    const r = t.canvas.getBoundingClientRect();
    if (r.width < 2) continue;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (t.canvas.width !== w || t.canvas.height !== h) {
      t.canvas.width = w;
      t.canvas.height = h;
    }
  }
}

/** 四个格子各画一次「你自己」的实时五官：把主画布的用户坐标缩放进格子 */
function drawPreviews() {
  const st = app.state;
  if (!st || !ui.tiles.length) return;
  const dpr = app.dpr;
  const pal = PALETTES[app.settings.palette];
  for (const t of ui.tiles) {
    const c = t.canvas.getContext('2d');
    const pw = t.canvas.width / dpr;
    const ph = t.canvas.height / dpr;
    if (pw < 2 || ph < 2) continue;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, pw, ph);
    const faceW = Math.max(st.face.w || Math.min(app.W, app.H) * 0.3, 8);
    const faceH = Math.max(st.face.h || faceW * 1.2, 8);
    // 横向按脸宽、纵向按五官实际跨度（眉心到嘴约 0.8 倍脸高）来定缩放，两边都留余量
    const s = Math.min((pw * 0.62) / faceW, (ph * 0.86) / Math.max(faceH * 0.8, 8));
    c.setTransform(dpr * s, 0, 0, dpr * s, dpr * (pw / 2 - st.face.cx * s), dpr * (ph / 2 - st.face.cy * s));
    render(c, t.id, st, { W: app.W, H: app.H, t: st.t, pal });
  }
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
}

function setStatus(kind, text, sub = '') {
  el.dot.className = `dot ${kind}`;
  el.statusText.textContent = text;
  el.statusSub.textContent = sub;
}

function showHint(msg) {
  el.hint.textContent = msg;
  el.hint.classList.add('show');
}
function hideHint() {
  el.hint.classList.remove('show');
}

function fatal(title, msg, hint) {
  el.fatal.hidden = false;
  el.fatalTitle.textContent = title;
  el.fatalMsg.textContent = msg;
  el.fatalHint.innerHTML = hint || '';
  el.boot.style.display = 'none';
}

function hideBoot() {
  el.boot.style.display = 'none';
}

// ---------------------------------------------------------------- 画布
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  app.dpr = dpr;
  app.W = window.innerWidth;
  app.H = window.innerHeight;
  el.canvas.width = Math.round(app.W * dpr);
  el.canvas.height = Math.round(app.H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (ui.open) {
    sizePreviewCanvases();
    drawPreviews();
  }
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- 多人：点谁切换谁
function hitTestPerson(x, y) {
  const hit = personRects().filter((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  if (!hit.length) return null;
  // 重叠时取范围最小的那个（更贴脸）
  hit.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
  return hit[0].p;
}

/** 点已经选中的那位 = 直接给他换画风；点别人 = 切换过去（并按设置弹选择） */
function pickPersonAt(x, y) {
  const p = hitTestPerson(x, y);
  if (!p) return false;
  if (p.id === app.activeId) {
    if (app.settings.autoPrompt && !ui.open) openChooser('switch');
  } else {
    setActivePerson(p.id, { openPicker: true });
  }
  return true;
}

el.canvas.addEventListener('pointerdown', (e) => {
  const r = el.canvas.getBoundingClientRect();
  pickPersonAt(e.clientX - r.left, e.clientY - r.top);
});
el.canvas.addEventListener('pointermove', (e) => {
  const r = el.canvas.getBoundingClientRect();
  const over = hitTestPerson(e.clientX - r.left, e.clientY - r.top);
  el.canvas.style.cursor = over ? 'pointer' : 'default';
});

function cyclePerson() {
  const list = app.people.filter((p) => p.box);
  if (list.length < 2) return;
  const i = list.findIndex((p) => p.id === app.activeId);
  setActivePerson(list[(i + 1) % list.length].id, { openPicker: false });
}

// ---------------------------------------------------------------- 摄像头
function cameraErrorText(err) {
  const n = err?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return [
      '摄像头权限被拒绝',
      '点地址栏左侧的摄像头图标 → 允许，然后点「重试」。',
      '如果是在「文件预览面板」里打开的，摄像头通常会被拦掉——请用资源管理器双击，让 Edge 打开这个文件。',
    ];
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return ['没有找到可用的摄像头', '确认设备已连接，或在下拉框里换一个摄像头。', ''];
  if (n === 'NotReadableError') return ['摄像头被别的程序占用了', '关掉会议/相机类软件后重试。', ''];
  return ['摄像头打不开', String(err?.message || err), '可以试试换浏览器（Edge / Chrome 较新版本）。'];
}

function reportCameraError(err) {
  const [t, m, h] = cameraErrorText(err);
  app.cameraError = t;
  setStatus('err', t, m);
  showHint(`${t}：${m}`);
  console.warn('[camera]', err);
}

function stopCamera() {
  if (app.stream) {
    for (const t of app.stream.getTracks()) t.stop();
    app.stream = null;
  }
  el.video.srcObject = null;
}

async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    app.devices = devices.filter((d) => d.kind === 'videoinput');
    el.camSelect.innerHTML = '';
    app.devices.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `摄像头 ${i + 1}`;
      el.camSelect.appendChild(o);
    });
    if (app.deviceId) el.camSelect.value = app.deviceId;
  } catch {
    /* 枚举失败不影响使用 */
  }
}

async function startCamera(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    reportCameraError(new Error('当前页面上下文不允许使用摄像头（例如在文件预览面板 / iframe 里打开）。请用浏览器直接打开这个文件。'));
    return;
  }
  stopCamera();
  const constraints = { width: VIDEO_CONSTRAINTS.width, height: VIDEO_CONSTRAINTS.height, frameRate: VIDEO_CONSTRAINTS.frameRate };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  else constraints.facingMode = VIDEO_CONSTRAINTS.facingMode;

  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  app.stream = stream;
  el.video.srcObject = stream;
  await el.video.play().catch(() => {});
  app.cameraError = null;
  app.running = true;
  const track = stream.getVideoTracks()[0];
  const st = track.getSettings ? track.getSettings() : {};
  app.deviceId = st.deviceId || deviceId || null;
  app.camInfo = `${st.width || '?'}×${st.height || '?'}`;
  // 设备枚举不挡路：画面已经出来了，列表慢一点无所谓
  listCameras().then(() => {
    if (app.deviceId) el.camSelect.value = app.deviceId;
  });
}

// ---------------------------------------------------------------- 覆盖层绘制
function project(lm, v) {
  const nx = 1 - lm.x;
  return {
    x: v.W / 2 + (nx - v.faceCx) * v.S + v.offX,
    y: v.H / 2 + (lm.y - v.faceCy) * v.Sy + v.offY,
  };
}

function drawPip(state, W, H) {
  const mode = app.settings.view;
  if (mode === 'off' || !app.stream) return;
  const vw = Math.min(W * 0.26, mode === 'debug' ? 320 : 220);
  const vh = vw * ((el.video.videoHeight || 480) / (el.video.videoWidth || 640));
  const x = W - vw - 18;
  const y = H - vh - 18;
  ctx.save();
  ctx.beginPath();
  const r = 12;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + vw, y, x + vw, y + vh, r);
  ctx.arcTo(x + vw, y + vh, x, y + vh, r);
  ctx.arcTo(x, y + vh, x, y, r);
  ctx.arcTo(x, y, x + vw, y, r);
  ctx.closePath();
  ctx.clip();
  ctx.translate(x + vw, y);
  ctx.scale(-1, 1);
  try {
    ctx.drawImage(el.video, 0, 0, vw, vh);
  } catch {
    /* 视频未就绪 */
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(x, y, vw, vh);
  ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y + vh - 18, 52, 18);
  ctx.fillStyle = '#fff';
  ctx.font = '500 11px system-ui, "Microsoft YaHei", sans-serif';
  ctx.fillText('你', x + 8, y + vh - 5);
  ctx.restore();
}

function drawLandmarks(state) {
  const raw = state.raw;
  if (!raw) return;
  const v = state.view;
  const P = raw.landmarks;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < P.length; i++) {
    const p = project(P[i], v);
    ctx.fillRect(p.x - 0.75, p.y - 0.75, 1.5, 1.5);
  }
  const keys = [33, 133, 159, 145, 362, 263, 386, 374, 468, 473, 105, 334, 1, 2, 13, 14, 61, 291, 10, 152, 234, 454];
  ctx.fillStyle = '#ffd166';
  for (const k of keys) {
    const p = project(P[k], v);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 调试视图：把真实画面按同一套映射半透明铺在五官底下，用来核对镜像方向与贴合度 */
function drawDebugVideo(state) {
  const v = state.view;
  if (!app.stream || !v.S) return;
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.translate(v.W / 2 - v.faceCx * v.S + v.offX + v.S, v.H / 2 - v.faceCy * v.Sy + v.offY);
  ctx.scale(-1, 1);
  try {
    ctx.drawImage(el.video, 0, 0, v.S, v.Sy);
  } catch {
    /* 视频未就绪 */
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 主循环
/** 一个人的一次"在场"：独立的状态机（自适应基线互不影响）+ 独立的画风/配色 */
function createPerson(id) {
  return {
    id,
    engine: new SignalEngine(),
    style: app.settings.style,
    palette: app.settings.palette,
    state: null,
    box: null,
    prevC: null,
    lastSeen: 0,
  };
}

function activePerson() {
  return app.people.find((p) => p.id === app.activeId) || app.people[0] || null;
}

function envOf(person) {
  const st = person && person.state;
  return {
    W: app.W,
    H: app.H,
    t: st ? st.t : 0,
    pal: PALETTES[(person && person.palette) || app.settings.palette],
  };
}

/** 新面孔出现 / 离开 ≥5 秒又回来：都算"来了一位"，切到他并（按设置）弹画风选择 */
function onPersonArrived(p, returning) {
  const before = app.activeId;
  app.activeId = p.id;
  ui.appearance += 1;
  // 面板跟着切到这个人的设置
  app.settings.style = p.style;
  app.settings.palette = p.palette;
  syncUi();
  if (!app.settings.autoPrompt) return;
  // 人多了以后挨个弹窗会互相打断：画面里已经有好几位时，只提示一下，让他自己按 C 选
  if (app.people.filter((x) => x.box).length > CHOOSER_AUTO_MAX_PEOPLE) {
    if (!ui.open) toast('又来了一位 · 按 C 给他选画风');
    return;
  }
  if (!ui.open) openChooser(returning ? 'return' : 'auto');
}

/**
 * 把这一帧检出的所有脸关联到已有的人：按"离上一帧谁最近"匹配（MediaPipe 不给稳定 id），
 * 匹配不到就新建一个会话；久未出现的退休（≥5 秒，对应"换了个人"的判定阈值）。
 */
function trackPeople(faces, dt, now) {
  const env = {
    W: app.W,
    H: app.H,
    zoom: app.settings.zoom,
    follow: app.settings.follow,
    sensitivity: app.settings.sensitivity,
    aspect: el.video.videoWidth ? el.video.videoHeight / el.video.videoWidth : 0.75,
  };
  const used = new Set();
  for (const f of faces) {
    const c = { x: (f.box.x0 + f.box.x1) / 2, y: (f.box.y0 + f.box.y1) / 2 };
    let best = null;
    let bestD = 0.16; // 归一化距离阈值（约脸宽 1/4），超过就当成另一个人
    for (const p of app.people) {
      if (used.has(p.id) || !p.prevC) continue;
      const d = Math.hypot(c.x - p.prevC.x, c.y - p.prevC.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) {
      // 新面孔：建会话 + 当成"来了一位"（要弹画风选择的就是这一步）
      best = createPerson(app.nextPersonId++);
      app.people.push(best);
      onPersonArrived(best, false);
    } else if (now - best.lastSeen > NEW_FACE_ABSENCE_SEC * 1000) {
      onPersonArrived(best, true); // 走了很久又回来 = 又来了一位
    }
    used.add(best.id);
    best.prevC = c;
    best.box = f.box;
    best.lastSeen = now;
    best.state = best.engine.update({ landmarks: f.landmarks, blendshapes: f.blendshapes }, dt, env);
    // 诊断用：这一帧这个人吃的是哪张脸、结果落在哪里
    best.dbg = {
      faceIdx: faces.indexOf(f),
      rawC: { x: +c.x.toFixed(3), y: +c.y.toFixed(3) },
      outFaceCx: Math.round(best.state.face.cx),
      outEye0X: Math.round(best.state.eyes[0].x),
      engine: best.engine.__tag || (best.engine.__tag = Math.random().toString(36).slice(2, 6)),
    };
  }
  // 这一帧没匹配上的：喂 null 让它"睡着"；离开超过阈值且不是唯一一位就退场
  for (const p of app.people) {
    if (!used.has(p.id)) {
      p.state = p.engine.update(null, dt, env);
      p.box = null;
    }
  }
  for (let i = app.people.length - 1; i >= 0; i--) {
    const p = app.people[i];
    if (!used.has(p.id) && now - p.lastSeen > NEW_FACE_ABSENCE_SEC * 1000 && app.people.length > 1) app.people.splice(i, 1);
  }
  if (!app.people.some((p) => p.id === app.activeId)) app.activeId = app.people[0] ? app.people[0].id : null;
  app.peopleOnScreen = used.size;
}

/** 每个人在画布上的可点击范围：**贴着画出来的五官**，不是整张脸（人多了才不会互相压住） */
function personRects() {
  const out = [];
  for (const p of app.people) {
    const st = p.state;
    if (!st || !p.box) continue;
    const e0 = st.eyes[0];
    const e1 = st.eyes[1];
    if (!e0 || !e1) continue;
    const eyeSpan = Math.abs(e0.x - e1.x);
    const halfW = Math.max(eyeSpan * 0.8, e0.w * 1.9, 46); // 半宽：略宽于两眼外侧
    const top = Math.min(e0.y, e1.y) - Math.max(e0.w * 1.4, 30); // 上沿盖住眉毛
    const bottom = st.mouth.y + Math.max(st.mouth.w * 0.55, 26); // 下沿盖住嘴
    out.push({
      p,
      x0: st.face.cx - halfW,
      y0: top,
      x1: st.face.cx + halfW,
      y1: bottom,
    });
  }
  return out;
}

/** 只画某个人的五官（可选缩放/半透明）——背景不重画 */
function drawPersonFeatures(p, k = 1, alpha = 1) {
  const st = p.state;
  if (!st) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (k !== 1) {
    ctx.translate(st.face.cx, st.face.cy);
    ctx.scale(k, k);
    ctx.translate(-st.face.cx, -st.face.cy);
  }
  render(ctx, p.style, st, envOf(p), 'features');
  ctx.restore();
}

/** 每个人一个编号徽标：当前那位高亮一圈，并且提示"点我切换" */
function drawPersonBadges() {
  const rects = personRects();
  if (!rects.length) return;
  const multi = rects.length > 1;
  rects.forEach((r, idx) => {
    const isActive = r.p.id === app.activeId;
    if (!multi && !isActive) return;
    const pad = 10;
    ctx.save();
    ctx.globalAlpha = isActive ? 0.95 : 0.62;
    ctx.strokeStyle = isActive ? PALETTES[r.p.palette].accent : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = isActive ? 3 : 2;
    ctx.setLineDash(isActive ? [] : [7, 6]);
    const rr = 18;
    const x = r.x0 - pad;
    const y = r.y0 - pad;
    const w = r.x1 - r.x0 + pad * 2;
    const h = r.y1 - r.y0 + pad * 2;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.stroke();
    // 编号
    const label = `${idx + 1}${isActive ? ' · 当前' : ''}`;
    ctx.setLineDash([]);
    ctx.font = '600 13px system-ui, "Microsoft YaHei", sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.globalAlpha = isActive ? 0.92 : 0.6;
    ctx.fillStyle = 'rgba(18,18,26,0.72)';
    const bx = x + 2;
    const by = y - 22;
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + 18, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + 9, by + 14);
    ctx.restore();
  });
  if (multi) {
    // 底部提示：点谁切换谁
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.font = '500 13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    const msg = '画面里有 ' + rects.length + ' 个人 · 点谁就切换成谁（也可以按 Tab）';
    const tw = ctx.measureText(msg).width;
    ctx.fillStyle = 'rgba(18,18,26,0.7)';
    ctx.beginPath();
    ctx.roundRect(app.W / 2 - tw / 2 - 14, app.H - 74, tw + 28, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(msg, app.W / 2, app.H - 56);
    ctx.restore();
  }
}

/** 切换当前这个人 */
function setActivePerson(id, { openPicker = false } = {}) {
  const p = app.people.find((x) => x.id === id);
  if (!p || app.activeId === id) return;
  app.activeId = id;
  app.settings.style = p.style;
  app.settings.palette = p.palette;
  syncUi();
  const idx = app.people.findIndex((x) => x.id === id) + 1;
  toast(`已切换到第 ${idx} 个人 · ${(STYLES.find((s) => s.id === p.style) || {}).name || p.style}`);
  if (openPicker && app.settings.autoPrompt && !ui.open) openChooser('switch');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - (app.lastNow || now - 16)) / 1000, 0.001, 0.1);
  app.lastNow = now;
  if (dt > 0) app.fps = app.fps ? app.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;

  let faces = [];
  if (app.tracker && app.modelReady && el.video.readyState >= 2) {
    if (el.video.currentTime !== app.lastVideoTime) {
      app.lastVideoTime = el.video.currentTime;
      try {
        app.lastFaces = app.tracker.detect(el.video, now);
      } catch (err) {
        console.warn('[detect]', err);
      }
    }
    faces = app.lastFaces || [];
  }

  // 至少留一个会话：没人在画面里时，中间那副"睡着的五官"就是它
  if (!app.people.length) {
    app.people.push(createPerson(app.nextPersonId++));
    app.activeId = app.people[0].id;
    app.settings.style = app.people[0].style;
    app.settings.palette = app.people[0].palette;
    syncUi();
  }
  trackPeople(faces, dt, now);

  const act = activePerson();
  app.state = act ? act.state : null;
  if (app.state && app.override) applyOverride(app.state, app.override);

  const env = envOf(act);
  if (act) {
    render(ctx, act.style, act.state, env, 'all'); // 背景 + 当前这位的五官
    const others = app.people.filter((p) => p !== act && p.box);
    // 人越多，其他人画得越小（不然同框时互相压住）
    const k = others.length > 3 ? 0.4 : others.length > 1 ? 0.5 : 0.55;
    const alpha = others.length > 3 ? 0.72 : 0.82;
    for (const p of others) drawPersonFeatures(p, k, alpha); // 其他人：缩小、半透明
    if (others.length) drawPersonFeatures(act, 1, 1); // 当前这位再画一遍，压在最上层
  }
  drawPip(app.state, app.W, app.H);
  if (app.settings.view === 'debug') {
    drawDebugVideo(app.state);
    drawLandmarks(app.state);
  }
  drawPersonBadges();
  if (ui.open && now - ui.lastPreview > 90) {
    ui.lastPreview = now;
    drawPreviews();
  }

  updateStatus();
}

let statusTick = 0;
function updateStatus() {
  if (performance.now() - statusTick < 250) return;
  statusTick = performance.now();
  const st = app.state;
  const fps = Math.round(app.fps);
  if (app.cameraError) {
    setStatus('err', app.cameraError, '点面板里的「摄像头」下拉框，或刷新页面重试');
    return;
  }
  if (!app.modelReady) {
    setStatus('warn', '模型载入中…', '');
    return;
  }
  if (!st) return;
  const n = app.people.filter((p) => p.box).length;
  if (st.detected) {
    hideHint();
    const who = n > 1 ? `已识别到 ${n} 个人 · 当前第 ${app.people.findIndex((p) => p.id === app.activeId) + 1} 位` : '已识别到你的脸';
    setStatus('on', who, `${app.tracker?.delegate || '-'} · ${fps}fps · ${app.camInfo || ''}${n > 1 ? ' · 点画面里的人切换' : ''}`);
  } else {
    setStatus('warn', '没有看到脸', `${fps}fps · 把脸放进取景范围、光线亮一点`);
    if (app.settings.showHint) showHint(`把脸放进画面里，五官就会出现～（最多同时 ${MAX_FACES} 个人）`);
  }
}

// ---------------------------------------------------------------- 截图
function snapshot() {
  const st = app.state;
  if (!st) return;
  const cv = document.createElement('canvas');
  cv.width = el.canvas.width;
  cv.height = el.canvas.height;
  const c = cv.getContext('2d');
  c.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  const act = activePerson();
  render(c, app.settings.style, st, { W: app.W, H: app.H, t: st.t, pal: PALETTES[app.settings.palette] });
  // 多人同框时，其他几位也一起拍进去（缩小、半透明，和屏幕上一致）
  const others = app.people.filter((p) => p !== act && p.box && p.state);
  const kShot = others.length > 3 ? 0.4 : others.length > 1 ? 0.5 : 0.55;
  for (const p of others) {
    c.save();
    c.globalAlpha = others.length > 3 ? 0.72 : 0.82;
    c.translate(p.state.face.cx, p.state.face.cy);
    c.scale(kShot, kShot);
    c.translate(-p.state.face.cx, -p.state.face.cy);
    render(c, p.style, p.state, { W: app.W, H: app.H, t: p.state.t, pal: PALETTES[p.palette] }, 'features');
    c.restore();
  }
  if (act) render(c, app.settings.style, st, { W: app.W, H: app.H, t: st.t, pal: PALETTES[app.settings.palette] }, 'features');
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `五官镜像-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('已保存到「下载」文件夹');
  }, 'image/png');
}

// ---------------------------------------------------------------- 调试注入
/** 供离线核对使用：用归一化坐标直接摆出五官姿态，绕过摄像头 */
function applyOverride(S, o) {
  const W = app.W;
  const H = app.H;
  const M = Math.min(W, H);
  const X = (v) => v * W;
  const Y = (v) => v * H;
  const Z = (v) => v * M;
  if (o.face) {
    const f = o.face;
    if (f.cx != null) S.face.cx = X(f.cx);
    if (f.cy != null) S.face.cy = Y(f.cy);
    if (f.w != null) S.face.w = Z(f.w);
    if (f.h != null) S.face.h = Z(f.h);
  }
  const defFace = { cx: 0.5, cy: 0.5, w: Z(0.42), h: Z(0.58) };
  const fcx = S.face.cx || defFace.cx * W;
  const fcy = S.face.cy || defFace.cy * H;
  const fw = S.face.w || defFace.w;
  if (o.sleepy != null) S.sleepy = o.sleepy; // 离线核对用：强制"醒着"，否则闭眼会被当成睡着
  if (o.eyes) {
    o.eyes.forEach((e, i) => {
      const t = S.eyes[i];
      if (!t) return;
      const side = e.side != null ? e.side : i === 0 ? 1 : -1;
      t.side = side;
      t.x = e.x != null ? X(e.x) : fcx + side * fw * 0.22;
      t.y = e.y != null ? Y(e.y) : fcy - Z(0.06);
      t.w = e.w != null ? Z(e.w) : fw * 0.2;
      t.h = e.h != null ? Z(e.h) : t.w * 0.45;
      t.open = e.open != null ? e.open : 0.85;
      t.blink = 1 - t.open;
      t.gazeX = e.gazeX || 0;
      t.gazeY = e.gazeY || 0;
      t.wide = e.wide || 0;
      t.squint = e.squint || 0;
      t.joy = e.joy || 0;
      t.tilt = e.tilt || 0;
    });
  }
  if (o.brows) {
    o.brows.forEach((b, i) => {
      const t = S.brows[i];
      if (!t) return;
      const side = b.side != null ? b.side : i === 0 ? 1 : -1;
      t.side = side;
      t.x = b.x != null ? X(b.x) : fcx + side * fw * 0.22;
      t.y = b.y != null ? Y(b.y) : fcy - Z(0.15);
      t.w = b.w != null ? Z(b.w) : fw * 0.22;
      t.raise = b.raise || 0;
      t.innerUp = b.innerUp || 0;
      t.down = b.down || 0;
      t.angle = b.angle || 0;
    });
  }
  if (o.nose) {
    const n = o.nose;
    S.nose.x = n.x != null ? X(n.x) : fcx;
    S.nose.y = n.y != null ? Y(n.y) : fcy + Z(0.02);
    S.nose.w = n.w != null ? Z(n.w) : fw * 0.14;
    S.nose.sneer = n.sneer || 0;
    S.nose.wiggle = n.wiggle || 0;
  }
  if (o.mouth) {
    const m = o.mouth;
    S.mouth.x = m.x != null ? X(m.x) : fcx;
    S.mouth.y = m.y != null ? Y(m.y) : fcy + Z(0.14);
    S.mouth.w = m.w != null ? Z(m.w) : fw * 0.3;
    for (const k of ['open', 'smile', 'frown', 'pucker', 'stretch', 'press', 'shift', 'tongue', 'upperUp', 'lowerDown']) {
      if (m[k] != null) S.mouth[k] = m[k];
    }
  }
  if (o.cheek) {
    if (o.cheek.blush != null) S.cheek.blush = o.cheek.blush;
    if (o.cheek.puff != null) S.cheek.puff = o.cheek.puff;
  }
  if (o.mood) {
    if (o.mood.joy != null) S.mood.joy = o.mood.joy;
    if (o.mood.surprise != null) S.mood.surprise = o.mood.surprise;
    if (o.mood.sleepy != null) S.mood.sleepy = o.mood.sleepy;
  }
  if (o.view) {
    const sc = app.settings.zoom * Math.min(W, H);
    S.view = { W, H, S: sc, Sy: sc * 0.75, offX: 0, offY: 0, aspect: 0.75, faceCx: 0.5, faceCy: 0.5, follow: 1, mirror: true };
  }
}

// ---------------------------------------------------------------- 启动
/** HTML 转义：错误原文里可能含 `<script>` 这类字样，直接塞 innerHTML 会被当标签吞掉后面所有文字 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 把各种意外抛出来的东西（Error / Event / 字符串）变成能读的一句话 */
function errText(err) {
  if (!err) return '未知错误';
  if (err instanceof Error) return err.message;
  if (typeof Event !== 'undefined' && err instanceof Event) {
    const t = err.target || {};
    const tag = t.tagName ? ' <' + String(t.tagName).toLowerCase() + '>' : '';
    const src = t.src ? ' src=' + String(t.src).slice(0, 80) : '';
    return `资源加载失败（事件 ${err.type}${tag}${src}）`;
  }
  try {
    const s = typeof err === 'string' ? err : JSON.stringify(err);
    return s && s !== '{}' ? s : String(err);
  } catch {
    return String(err);
  }
}

/** 出错时把环境信息一并显示出来，免得再来回猜 */
function envReport() {
  const T = window.__fmTimings || {};
  const ms = (a, b) => (a != null && b != null ? Math.round(a - b) + 'ms' : '-');
  let csp = '（页面上没有 CSP meta，可能是响应头设置的，取不到）';
  try {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
    if (m) csp = String(m.content).slice(0, 220);
  } catch {
    /* 忽略 */
  }
  const nav = performance.getEntriesByType('navigation')[0] || {};
  return [
    '构建 ' + (window.__FM_BUILD || '(源码版)'),
    '协议 ' + location.protocol + ' · 安全上下文 ' + isSecureContext,
    'baseURI ' + String(document.baseURI).slice(0, 70),
    'CSP ' + csp,
    '耗时 解码 ' + ms(T.decodeEnd, T.decodeStart) + ' / fileset ' + ms(T.filesetEnd, T.filesetStart) + ' / 建任务 ' + ms(T.createEnd, T.createStart),
    '胶水层 ' + (typeof globalThis.ModuleFactory === 'function' ? '就绪' : '未就绪'),
    '文档 ' + Math.round((nav.domContentLoadedEventEnd || 0)) + 'ms 解析完',
  ].join('\n');
}

async function boot() {
  try {
    await bootInner();
  } catch (err) {
    console.error('[boot]', err);
    const msg = esc(errText(err));
    const detail = envReport() + '\n\n' + String((err && err.stack) || '').slice(0, 500);
    if (window.__fmShowProblem) {
      window.__fmShowProblem('启动失败', msg, detail);
    } else {
      fatal('启动失败', msg, detail);
    }
  }
}

/**
 * 先探一下这个环境到底能不能编译 WebAssembly。
 * 有些「文件预览面板」会下 `script-src 'unsafe-inline'` 这种 CSP，它**不允许 wasm 编译**
 * （缺 `wasm-unsafe-eval`），MediaPipe 在里面根本起不来。与其让人对着
 * "模型载入失败"发呆，不如当场说清楚：换个窗口打开。
 */
function checkWasmAllowed() {
  try {
    // 最小合法 wasm 模块（magic + version），只为触发一次编译
    new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    return { ok: true };
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/Content Security Policy|wasm-unsafe-eval|unsafe-eval/i.test(m)) {
      return {
        ok: false,
        msg:
          '打开它的程序禁止运行 <b>WebAssembly</b>（内容安全策略里缺 <code>wasm-unsafe-eval</code>），' +
          '人脸模型没法启动。<br /><br />这不是文件的问题：<b>请用资源管理器双击这个文件，' +
          '让 Microsoft Edge 打开</b>，那里没有这条限制。',
      };
    }
    return { ok: false, msg: '当前环境不支持 WebAssembly：' + m };
  }
}

async function bootInner() {
  loadSettings();
  resize();
  buildUi();
  requestAnimationFrame(frame);

  const wasmCheck = checkWasmAllowed();
  if (!wasmCheck.ok) {
    hideBoot();
    if (window.__fmShowProblem) window.__fmShowProblem('这个窗口跑不了这个页面', wasmCheck.msg, '');
    else fatal('这个窗口跑不了这个页面', wasmCheck.msg, '');
    return;
  }

  app.tracker = new FaceTracker();
  let bootTick = 0;
  const bootTimer = setInterval(() => {
    bootTick += 0.1;
    el.bootMsg.textContent = `${bootTick.toFixed(1)} 秒`;
  }, 100);
  // 摄像头与模型**并行**启动：权限弹窗和出画面都不用等模型
  const cameraPromise = startCamera(null).catch((err) => reportCameraError(err));
  try {
    setStatus('warn', '正在载入人脸模型…', '本地模型，不需要联网');
    T.initStart = performance.now();
    await app.tracker.init();
    T.initEnd = performance.now();
    app.modelReady = true;
  } catch (err) {
    console.error('[model]', err);
    const msg = esc(errText(err));
    if (window.__fmShowProblem) {
      window.__fmShowProblem(
        '人脸模型载入失败',
        msg +
          '<br /><br />· <b>在聊天窗口里点文件卡片</b>，用的是客户端自带的预览器（<code>blob:dsh-app://…</code>），' +
          '那个环境会拦掉 WebAssembly 相关加载 —— 请改用同目录下的 <b>打开-五官镜像.url</b> 或 ' +
          '<b>打开-五官镜像.bat</b>（都会用 Edge 打开），或直接在资源管理器里双击 <b>五官镜像.html</b>。' +
          '<br />· 若是源码版：请用「启动-面容镜像.bat」打开。',
        envReport() + '\n\n' + String((err && err.stack) || '').slice(0, 500)
      );
    } else {
      fatal('人脸模型载入失败', msg, '');
    }
    clearInterval(bootTimer);
    return;
  }

  await cameraPromise;
  hideBoot();
  clearInterval(bootTimer);
  window.__fmReady = true;
  T.ready = performance.now();
  // 资源脚本排在应用脚本之后，所以这里再读一次它的时间戳
  const startAt = window.__fmPayloadAt || T.main;
  const bootSec = ((T.ready - startAt) / 1000).toFixed(2);
  updateStatus();
  setStatus(
    app.cameraError ? 'err' : 'warn',
    app.cameraError || '模型已就绪，等待识别',
    `${app.tracker.delegate} 委托 · 载入 ${bootSec}s · ${app.camInfo || ''}`
  );
  if (!app.cameraError) toast('把脸放进画面，五官就跟着你动');
}

// 调试 / 离线核对接口
window.__fm = {
  get ready() {
    // 「就绪」= 模型 + 摄像头都好了（之前只等模型，会误报就绪）
    return !!window.__fmReady;
  },
  setOverride(o) {
    app.override = o;
  },
  clearOverride() {
    app.override = null;
  },
  setSettings(patch) {
    // style / palette 要走正常入口，否则不会记到"当前这个人"身上（多人时两边会串）
    const { style, palette, ...rest } = patch || {};
    Object.assign(app.settings, rest);
    if (style) setStyle(style);
    if (palette) setPalette(palette);
    syncUi();
  },
  chooser() {
    return {
      open: ui.open,
      appearance: ui.appearance,
      promptedAppearance: ui.promptedAppearance,
      autoPrompt: !!app.settings.autoPrompt,
      tiles: ui.tiles.map((t) => {
        const r = t.el.getBoundingClientRect();
        return { id: t.id, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
      }),
    };
  },
  /** 多人状态：谁在画面里、谁是当前 */
  people() {
    return {
      activeId: app.activeId,
      onScreen: app.people.filter((p) => p.box).length,
      list: app.people.map((p, i) => {
        const st = p.state;
        const r = personRects().find((q) => q.p === p);
        return {
          index: i + 1,
          id: p.id,
          style: p.style,
          palette: p.palette,
          onScreen: !!p.box,
          active: p.id === app.activeId,
          faceW: st ? Math.round(st.face.w) : 0,
          face: st ? { cx: Math.round(st.face.cx), cy: Math.round(st.face.cy), w: Math.round(st.face.w), h: Math.round(st.face.h) } : null,
          eyes: st ? st.eyes.map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), open: +e.open.toFixed(2) })) : null,
          mouth: st ? { x: Math.round(st.mouth.x), y: Math.round(st.mouth.y), w: Math.round(st.mouth.w) } : null,
          detected: st ? st.detected : false,
          dbg: p.dbg || null,
          center: st ? { x: Math.round(st.face.cx), y: Math.round(st.face.cy) } : null,
          hit: r ? { x: Math.round((r.x0 + r.x1) / 2), y: Math.round((r.y0 + r.y1) / 2) } : null,
        };
      }),
    };
  },
  setActive(id) {
    setActivePerson(id, { openPicker: false });
    return app.activeId;
  },
  cycle() {
    cyclePerson();
    return app.activeId;
  },
  /** 模拟一次点击（坐标是画布 CSS px） */
  click(x, y) {
    return pickPersonAt(x, y);
  },
  openChooser(reason) {
    openChooser(reason || 'manual');
  },
  closeChooser() {
    closeChooser('manual');
  },
  info() {
    const st = app.state;
    return {
      style: app.settings.style,
      palette: app.settings.palette,
      fps: Math.round(app.fps),
      delegate: app.tracker?.delegate,
      modelReady: app.modelReady,
      cameraError: app.cameraError,
      detected: !!st?.detected,
      presence: st?.presence,
      sleepy: st?.sleepy,
      faceCx: st?.face.cx,
      faceCy: st?.face.cy,
      faceW: st?.face.w,
      eyeOpenA: st?.eyes[0].open,
      eyeOpenB: st?.eyes[1].open,
      mouthOpen: st?.mouth.open,
      smile: st?.mouth.smile,
      joy: st?.mood.joy,
      chooserOpen: ui.open,
      appearance: ui.appearance,
      view: st?.view,
    };
  },
  snapshot() {
    return JSON.parse(
      JSON.stringify(app.state, (k, v) => (typeof v === 'function' ? undefined : k === 'raw' ? undefined : v))
    );
  },
  rerender() {
    if (app.state) render(ctx, app.settings.style, app.state, envOf());
  },
  timings() {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      ...T,
      nav: nav ? { domInteractive: nav.domInteractive, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd } : null,
    };
  },
};

window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  // 多人：Tab 轮换、Alt+1–4 直接选第 N 位
  if (k === 'tab' && !ui.open) {
    e.preventDefault();
    cyclePerson();
    return;
  }
  if (e.altKey && k >= '1' && k <= '8') {
    const list = app.people.filter((p) => p.box);
    const target = list[Number(k) - 1];
    if (target) setActivePerson(target.id, { openPicker: false });
    return;
  }
  // 画风选择打开时，1–4 直接选中并关闭，Esc 先不选
  if (ui.open) {
    if (k === 'escape') {
      closeChooser('skip');
      return;
    }
    if (k >= '1' && k <= '4') {
      const s = STYLES[Number(k) - 1];
      if (s) {
        setStyle(s.id);
        closeChooser('picked');
      }
      return;
    }
  }
  if (k === 'h') el.panel.classList.toggle('collapsed');
  else if (k === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  } else if (k === 's') snapshot();
  else if (k === 'c') openChooser('manual');
  else if (k === 'd') setView(app.settings.view === 'debug' ? 'pip' : 'debug');
  else if (k >= '1' && k <= '4') {
    const s = STYLES[Number(k) - 1];
    if (s) setStyle(s.id);
  }
});

boot();
