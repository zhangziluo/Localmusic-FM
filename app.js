const $ = s => document.querySelector(s);
console.log('极简FM · app.js?v=10 已加载');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ============ IndexedDB ============
const DB_NAME = 'fm-pwa-db', DB_STORE = 'handles';
let idb = null;
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => { idb = e.target.result; resolve(); };
    req.onerror = reject;
  });
}
function saveDirHandle(handle) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, 'music-dir');
    tx.oncomplete = resolve; tx.onerror = reject;
  });
}
function loadDirHandle() {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('music-dir');
    req.onsuccess = () => resolve(req.result); req.onerror = reject;
  });
}
function saveLibraryIndex() {
  try {
    localStorage.setItem('fm_library', JSON.stringify(state.tracks.map(t => ({
      name: t.name,
      fileName: t.file ? t.file.name : (t.fileName || ''),
      path: t.path || '',
    }))));
  } catch (e) { console.log('保存曲库索引失败:', e); }
}
function loadLibraryIndex() {
  try {
    const list = JSON.parse(localStorage.getItem('fm_library') || '[]');
    return Array.isArray(list)
      ? list.filter(t => t && typeof t.name === 'string')
      : [];
  } catch (e) { return []; }
}

function isFavorite(name, fileName) {
  return state.favorites.has(fileName) || state.favorites.has(name);
}

const UNLOCK_TRACKS = 15;   // 曲库超过该数量后解锁 CH3-CH9
const MAX_PLAY_SECONDS = 10000 * 3600; // 到 10000:00:00 即归零，最大显示 9999:59:59

// 网络串流可绑定的按键：3-9 与 * 0（1 随机 / 2 红心 保留给本地曲库）
// 另开放编号 10-9999：没有实体键，通过 # 选号（输入编号后按 #）触发播放
// '#' 让位给按序号点歌 / 选台（前缀 + 确认），不再用于网络串流
const STREAM_KEYS = ['3', '4', '5', '6', '7', '8', '9', '*', '0'];
const MAX_STREAMS = 1000;      // 默认最多保存 1000 条串流地址
const MAX_STREAM_NUM = 9999;   // 编号上限，与选号输入位数一致

// 校验并规范化串流键：实体键原样返回，数字编号统一去掉前导 0；非法返回 null
function parseStreamKey(raw) {
  const key = String(raw == null ? '' : raw).trim();
  if (STREAM_KEYS.includes(key)) return key;
  if (!/^\d{1,4}$/.test(key)) return null;
  const n = parseInt(key, 10);
  if (!Number.isFinite(n) || n < 3 || n > MAX_STREAM_NUM) return null;
  return String(n);
}

// 数字编号（可通过 # 选号触发）与实体键分开排序
function isNumericStreamKey(key) {
  return /^\d+$/.test(key) && +key > 9;
}
function sortStreamKeys(keys) {
  const rank = k => (k === '*' ? 10001 : k === '0' ? 10002 : +k);
  return keys.slice().sort((a, b) => rank(a) - rank(b));
}

function saveStreams() {
  try { localStorage.setItem('fm_streams', JSON.stringify(state.streams)); }
  catch (e) { console.log('保存网络串流失败:', e); }
}
function loadStreams() {
  const out = {};
  try {
    const obj = JSON.parse(localStorage.getItem('fm_streams') || '{}');
    if (!obj || typeof obj !== 'object') return out;
    for (const rawKey of Object.keys(obj)) {
      if (Object.keys(out).length >= MAX_STREAMS) break;
      const key = parseStreamKey(rawKey);
      if (!key) continue;
      const v = obj[rawKey];
      if (v && typeof v.name === 'string' && typeof v.url === 'string'
          && /^https?:\/\//i.test(v.url)) {
        out[key] = { name: v.name.slice(0, 40), url: v.url };
      }
    }
  } catch (e) { console.log('读取网络串流失败:', e); }
  return out;
}

// ============ 状态 ============
const state = {
  tracks: [], played: [], current: null, playing: false,
  noiseOn: false, noiseVolume: 0.85, voiceInterval: 0,
  musicVolume: 1, totalPlayTime: 0, playStartTime: 0, rebooting: false,
  ch: 1, accent: '#ff8c42', cardStyle: 'dark',
  favorites: new Set(),
  streams: {}, mode: 'local', streamKey: null,
};

// 整点报时运行态（变量须在 updateClock 首次调用前初始化）
let chiming = false;          // 报时进行中，防重入
let lastChimedKey = '';       // 已报过的整点（年月日时），同一小时只报一次
let chimeResume = false;      // 报时前是否在播放，决定结束后是否恢复

// ============ 按序号点歌（# → 数字 → #）============
const dial = { active: false, buf: '', timer: 0 };
const DIAL_TIMEOUT = 5000;   // 选号态 5 秒无操作自动取消
const MAX_DIAL_DIGITS = 4;   // 最多输入 4 位（9999 首）

// ============ 彩蛋：数字键连击 ============
// 连续按出 19930214 或 930214，新窗口打开 create.myfami.cn
const EGG_CODES = ['19930214', '930214'];
const EGG_URL = 'https://create.myfami.cn/';
const EGG_TIMEOUT = 4000;    // 超过该间隔未继续输入则重新计数
let eggBuf = '';
let eggTimer = 0;

// ============ 界面主题 ============
const THEME_COLORS = ['#ff8c42','#42c02e','#007bff','#8b5cf6','#ec4899','#ef4444','#06b6d4','#6b7280'];
// 整页主题（crt/cream/tube）的默认强调色
const SKIN_ACCENT = { crt: '#33ff66', cream: '#e0b06a', tube: '#ffb000' };
// 主页 skin class（仅整页主题需要）
const SKIN_CLASSES = ['skin-crt', 'skin-cream', 'skin-tube'];
// 浏览器地址栏 / 状态栏配色
const META_COLOR = { dark: '#f5f5f0', led: '#f5f5f0', crt: '#060a07', cream: '#2b241b', tube: '#1c0f0a' };

function setAccent(color) {
  state.accent = color;
  document.documentElement.style.setProperty('--accent', color);
  document.querySelectorAll('.theme-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color === color);
  });
}

function updateMetaThemeColor() {
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
  m.setAttribute('content', META_COLOR[state.cardStyle] || '#ff8c42');
}

// resetAccent=true 时把强调色切到该整页主题的默认色（下拉切换时用）
function applyTheme(resetAccent = false) {
  const s = state.cardStyle;

  document.documentElement.classList.remove(...SKIN_CLASSES);
  if (SKIN_ACCENT[s]) document.documentElement.classList.add('skin-' + s);

  const dash = $('#dashboard');
  if (dash) {
    dash.classList.remove('theme-dark', 'theme-led', 'theme-crt', 'theme-cream', 'theme-tube');
    dash.classList.add('theme-' + s);
  }

  if (resetAccent && SKIN_ACCENT[s]) setAccent(SKIN_ACCENT[s]);
  else setAccent(state.accent);

  updateMetaThemeColor();
}

// ============ 初始化 ============
(async function init() {
  const cfg = JSON.parse(localStorage.getItem('fm_config') || '{}');
  state.totalPlayTime = cfg.totalPlayTime || 0;
  state.noiseOn = cfg.noiseOn || false;
  state.noiseVolume = typeof cfg.noiseVolume === 'number'
    ? Math.max(0, Math.min(1, cfg.noiseVolume)) : 0.85;
  state.musicVolume = typeof cfg.musicVolume === 'number'
    ? Math.max(0, Math.min(1, cfg.musicVolume)) : 1;
  state.voiceInterval = cfg.voiceInterval || 0;
  state.accent = cfg.accent || '#ff8c42';
  state.cardStyle = cfg.cardStyle || 'dark';
  const favs = JSON.parse(localStorage.getItem('fm_favs') || '[]');
  state.favorites = new Set(favs);
  state.streams = loadStreams();
  refreshDuration();

  applyTheme();
  refreshChannels();
  refreshStreamKeys();

  // 先恢复曲库索引；音频文件需要等文件夹授权后再重新扫描
  const savedIndex = loadLibraryIndex();
  if (savedIndex.length) {
    state.tracks = savedIndex.map(t => ({
      name: t.name,
      fileName: t.fileName || '',
      file: null,
      fav: isFavorite(t.name, t.fileName),
      path: t.path || '',
    }));
    refreshChannels();
    $('#led').textContent = `上次曲库 ${state.tracks.length} 首 · 正在恢复`;
  }

  // 恢复文件夹
  let savedHandle = null;
  try {
    await initDB();
    savedHandle = await loadDirHandle();
  } catch (e) { console.log('恢复失败:', e); }
  if (savedHandle) {
    await restoreLibrary(savedHandle, false);
  } else if (state.tracks.length) {
    $('#led').textContent = `上次曲库 ${state.tracks.length} 首 · 请重新导入文件夹`;
  }
  refreshDuration();
})();

// ============ 时钟 ============
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const s = String(now.getSeconds()).padStart(2,'0');
  const el = $('#dash-time');
  if (el) el.textContent = `${h}:${m}:${s}`;
  maybeChime(now);
}
updateClock(); setInterval(updateClock, 1000);

// ============ 时长 ============
function fmtDuration(sec) {
  const h = String(Math.floor(sec/3600)).padStart(4,'0');
  const m = String(Math.floor((sec%3600)/60)).padStart(2,'0');
  const s = String(Math.floor(sec%60)).padStart(2,'0');
  return `${h}:${m}:${s}`;
}

function playTimeNow() {
  let cur = state.totalPlayTime;
  if (state.playing && state.playStartTime > 0) cur += (Date.now() - state.playStartTime)/1000;
  return cur;
}

// 时长归零；若归零瞬间正在播放，触发一次 0.2 秒的“设备重启”
function wrapPlayTime() {
  if (playTimeNow() < MAX_PLAY_SECONDS) return false;
  state.totalPlayTime = 0;
  state.playStartTime = (state.playing && state.playStartTime > 0) ? Date.now() : 0;
  saveConfig();
  if (state.playing) rebootScreen();
  return true;
}

function rebootScreen() {
  const dash = $('#dashboard');
  if (!dash || state.rebooting) return;
  state.rebooting = true;
  dash.classList.add('rebooting');
  // 底噪瞬间中断，0.2 秒后随屏幕一起恢复
  if (state.noiseOn && state.playing) stopNoise(0.02);
  const el = $('#dash-dur');
  if (el) el.textContent = '0000:00:00';
  setTimeout(() => {
    dash.classList.remove('rebooting');
    state.rebooting = false;
    refreshDuration();
    if (state.noiseOn && state.playing && !noiseSrc) startNoise();
  }, 200);
}

function refreshDuration() {
  if (state.rebooting) return;
  wrapPlayTime();
  const el = $('#dash-dur');
  if (el) el.textContent = fmtDuration(playTimeNow());
}
setInterval(refreshDuration, 1000);

// ============ 音频 ============
const audio = new Audio();

// ---- 底噪（粉红噪声 + 海浪音频，混合成一个通道） ----
const NOISE_TARGET_RMS = 0.08;   // 粉红噪声统一响度（RMS）
const WAVE_SRC = 'waves-Ds5uwdFe.mp3';  // 海浪底噪音频
let noiseCtx = null, noiseGain = null, noiseSrc = null;
let waveAudio = null, waveSrc = null;
const noiseBuffers = {};

function ensureNoiseCtx() {
  if (!noiseCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    noiseCtx = new AC();
    noiseGain = noiseCtx.createGain();
    noiseGain.gain.value = 0;
    noiseGain.connect(noiseCtx.destination);
    // 海浪音频：流式加载、循环，经同一个 noiseGain 与粉红噪声混合
    try {
      waveAudio = new Audio(WAVE_SRC);
      waveAudio.loop = true;
      waveAudio.preload = 'auto';
      waveAudio.volume = 0.8; // 内部平衡，与粉红噪声响度接近
      waveSrc = noiseCtx.createMediaElementSource(waveAudio);
      waveSrc.connect(noiseGain);
    } catch (e) {
      waveAudio = null; waveSrc = null;
      console.log('海浪底噪加载失败:', e);
    }
  }
  return noiseCtx;
}

// 首次交互时解锁 AudioContext（绕过自动播放限制）
function unlockNoise() {
  const ctx = ensureNoiseCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
document.addEventListener('pointerdown', unlockNoise, { passive: true });
document.addEventListener('keydown', unlockNoise);

// 生成 4 秒、首尾交叉淡化的可循环粉红噪声缓冲
function getNoiseBuffer() {
  const ctx = ensureNoiseCtx();
  if (!ctx) return null;
  const key = ctx.sampleRate + ':pink';
  if (noiseBuffers[key]) return noiseBuffers[key];

  const sr = ctx.sampleRate;
  const loopLen = Math.floor(sr * 4);
  const fade = Math.floor(sr * 0.15);
  const raw = new Float32Array(loopLen + fade);

  // 粉红噪声：Paul Kellet 多级一阶滤波
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }

  // 归一化到统一 RMS
  let sum = 0;
  for (let i = 0; i < raw.length; i++) sum += raw[i] * raw[i];
  const rms = Math.sqrt(sum / raw.length) || 1;
  const scale = NOISE_TARGET_RMS / rms;
  for (let i = 0; i < raw.length; i++) raw[i] *= scale;

  // 首尾交叉淡化，循环接缝处不会有爆音
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    raw[i] = raw[i] * a + raw[loopLen + i] * (1 - a);
  }

  const buffer = ctx.createBuffer(1, loopLen, sr);
  buffer.copyToChannel(raw.subarray(0, loopLen), 0);
  noiseBuffers[key] = buffer;
  return buffer;
}

function startNoise() {
  const ctx = ensureNoiseCtx();
  if (!ctx || noiseSrc) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const buffer = getNoiseBuffer();
  if (!buffer) return;
  noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = buffer;
  noiseSrc.loop = true;
  noiseSrc.connect(noiseGain);
  noiseSrc.start();
  // 海浪层与粉红噪声同步开始
  if (waveAudio) waveAudio.play().catch(() => {});
  const t = ctx.currentTime;
  noiseGain.gain.cancelScheduledValues(t);
  noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
  noiseGain.gain.linearRampToValueAtTime(state.noiseVolume, t + 0.3);
}

function stopNoise(fade = 0.25) {
  if (!noiseSrc) return;
  const ctx = noiseCtx, src = noiseSrc;
  noiseSrc = null;
  const t = ctx.currentTime;
  noiseGain.gain.cancelScheduledValues(t);
  noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
  noiseGain.gain.linearRampToValueAtTime(0, t + fade);
  try { src.stop(t + fade + 0.03); } catch (e) {}
  // 海浪层随 gain 一起淡出后再暂停，避免突然截断；若已重新开始则不暂停
  if (waveAudio) {
    const wa = waveAudio;
    setTimeout(() => { if (!noiseSrc) { try { wa.pause(); } catch (e) {} } }, fade * 1000 + 40);
  }
}


// 调节底噪音量（0~1）：播放中实时平滑过渡，未播放时只记状态
// 粉红噪声与海浪层都经过 noiseGain，因此一个推子同时控制两者的混合音量
function setNoiseVolume(v) {
  state.noiseVolume = Math.max(0, Math.min(1, v));
  if (!noiseCtx || !noiseGain || !noiseSrc) return;
  const t = noiseCtx.currentTime;
  noiseGain.gain.cancelScheduledValues(t);
  noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
  noiseGain.gain.linearRampToValueAtTime(state.noiseVolume, t + 0.12);
}

// ============ 整点报时 ============
// 播放中每逢整点：先响「12 小时制的小时数」声哔，再用系统 TTS 播报
// 地点按设备时区推断（离线零依赖）：中国时区报「北京」，其余报当地城市
const CHINA_TIMEZONES = [
  'Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi',
];
const CITY_NAMES = {
  'Asia/Hong_Kong': '香港', 'Asia/Macau': '澳门', 'Asia/Taipei': '台北',
  'Asia/Tokyo': '东京', 'Asia/Seoul': '首尔', 'Asia/Singapore': '新加坡',
  'Asia/Bangkok': '曼谷', 'Asia/Dubai': '迪拜', 'Asia/Kolkata': '加尔各答',
  'Asia/Jakarta': '雅加达', 'Asia/Manila': '马尼拉', 'Asia/Karachi': '卡拉奇',
  'Europe/London': '伦敦', 'Europe/Paris': '巴黎', 'Europe/Berlin': '柏林',
  'Europe/Moscow': '莫斯科', 'Europe/Madrid': '马德里', 'Europe/Rome': '罗马',
  'America/New_York': '纽约', 'America/Los_Angeles': '洛杉矶',
  'America/Chicago': '芝加哥', 'America/Toronto': '多伦多',
  'America/Vancouver': '温哥华', 'America/Sao_Paulo': '圣保罗',
  'Australia/Sydney': '悉尼', 'Australia/Melbourne': '墨尔本',
  'Pacific/Auckland': '奥克兰',
};
const CHIME_BEEP_HZ = 880;
const CHIME_BEEP_LEN = 0.14;   // 单声时长（秒）
const CHIME_BEEP_GAP = 0.26;   // 间隔（秒）

function resolveLocation(tz) {
  tz = tz || '';
  if (CHINA_TIMEZONES.includes(tz)) return '北京';
  if (CITY_NAMES[tz]) return CITY_NAMES[tz];
  const city = tz.split('/').pop() || '';
  if (!city) return '本地';
  if (/^(GMT|UTC)/i.test(city)) return 'UTC';
  return city.replace(/_/g, ' ');
}

function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    return '';
  }
}

// 12 小时制小时数：0 点与 12 点都是 12 下
function chimeHour12(h) {
  return h % 12 === 0 ? 12 : h % 12;
}

const CN_HOURS = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
function chimeHourText(h) {
  return CN_HOURS[chimeHour12(h)];
}

// 12 小时制时段，避免「一点整」分不清上午/下午
function chimePeriod(h) {
  if (h < 6) return '凌晨';
  if (h < 12) return '上午';
  if (h === 12) return '中午';
  if (h < 18) return '下午';
  return '晚上';
}

function buildChimeText(date, location) {
  const h = date.getHours();
  return `现在是${location}时间${chimePeriod(h)}${chimeHourText(h)}点整`;
}

// 用 Web Audio 合成短促「哔」声，count 声播完后回调
function playChimeBeeps(count, done) {
  const ctx = ensureNoiseCtx();
  if (!ctx || typeof ctx.createOscillator !== 'function') { done(); return; }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.05;
  for (let i = 0; i < count; i++) {
    const t = start + i * (CHIME_BEEP_LEN + CHIME_BEEP_GAP);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = CHIME_BEEP_HZ;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.012);
    gain.gain.setValueAtTime(0.35, t + CHIME_BEEP_LEN - 0.02);
    gain.gain.linearRampToValueAtTime(0, t + CHIME_BEEP_LEN);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + CHIME_BEEP_LEN + 0.02);
  }
  setTimeout(done, (count * (CHIME_BEEP_LEN + CHIME_BEEP_GAP) + 0.1) * 1000);
}

// 系统 TTS 播报，结束（或不可用 / 超时）后回调
function speakChime(text, done) {
  const synth = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!synth || typeof synth.speak !== 'function' || typeof Utterance !== 'function') {
    done();
    return;
  }
  let finished = false;
  const finish = () => { if (finished) return; finished = true; done(); };
  try {
    const u = new Utterance(text);
    u.lang = 'zh-CN';
    u.rate = 1;
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
    // 兜底：部分浏览器 onend 不触发，按文本长度估算上限
    setTimeout(finish, Math.max(6000, text.length * 450));
  } catch (e) {
    finish();
  }
}

function finishChime() {
  chiming = false;
  const resume = chimeResume;
  chimeResume = false;
  if (resume && state.playing) {
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
}

function runChime(date) {
  if (chiming) return;
  chiming = true;
  chimeResume = state.playing;
  if (chimeResume) audio.pause();   // 暂停音乐/串流；pause 监听里会停底噪
  const led = $('#led');
  if (led) led.textContent = '整点报时';
  const text = buildChimeText(date, resolveLocation(deviceTimezone()));
  playChimeBeeps(chimeHour12(date.getHours()), () => speakChime(text, finishChime));
}

function maybeChime(now) {
  if (chiming || !state.playing) return;
  // 整点后 2 秒内都算，容忍定时器漂移
  if (now.getMinutes() !== 0 || now.getSeconds() > 2) return;
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  if (key === lastChimedKey) return;
  lastChimedKey = key;
  runChime(now);
}

audio.addEventListener('play', () => {
  state.playStartTime = Date.now();
  const icon = $('#icon-play');
  if (icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
  if (state.noiseOn) startNoise();
});
audio.addEventListener('pause', () => {
  commitPlayTime(true);
  const icon = $('#icon-play');
  if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  stopNoise();
});
audio.addEventListener('ended', () => {
  commitPlayTime(true);
  if (state.mode === 'stream') {
    // 直播流结束（或点播流播完）：不自动切回本地曲目
    state.playing = false;
    $('#led').textContent = '网络串流已结束';
    return;
  }
  playTrack(pickNext());
});
audio.addEventListener('error', () => {
  if (state.mode !== 'stream') return;
  state.playing = false;
  $('#led').textContent = '串流加载失败 · 地址或网络异常';
});
audio.addEventListener('timeupdate', () => {
  if (state.mode === 'stream') {
    // 直播流没有有效时长，进度条保持满格
    const bar = $('#progress-bar');
    if (bar) bar.style.width = '100%';
    return;
  }
  if (audio.duration && isFinite(audio.duration)) {
    $('#progress-bar').style.width = (audio.currentTime / audio.duration * 100) + '%';
  }
});

// 播放中每 15 秒落盘一次；页面隐藏 / 关闭时立即结算，避免刷新丢失当前播放段
setInterval(() => { if (state.playing) commitPlayTime(false); }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') commitPlayTime(false);
});
window.addEventListener('pagehide', () => commitPlayTime(false));

function pickNext() {
  const playable = state.tracks.filter(t => t.file);
  if (!playable.length) return null;
  if (state.ch === 2) {
    const favs = playable.filter(t => t.fav);
    if (favs.length) return favs[Math.floor(Math.random()*favs.length)];
  }
  return playable[Math.floor(Math.random() * playable.length)];
}
let currentObjectUrl = null;
function playTrack(t) {
  if (!t || !t.file) return;
  state.mode = 'local';
  state.streamKey = null;
  state.current = t;
  audio.volume = state.musicVolume;
  const prevUrl = currentObjectUrl;
  currentObjectUrl = URL.createObjectURL(t.file);
  audio.src = currentObjectUrl;
  if (prevUrl) { try { URL.revokeObjectURL(prevUrl); } catch (e) {} }
  audio.play();
  state.playing = true;
  $('#track-title').textContent = t.name;
  $('#track-sub').textContent = `CH${state.ch}`;
  $('#btn-heart').classList.toggle('active', !!t.fav);
}

function saveConfig() {
  localStorage.setItem('fm_config', JSON.stringify({
    totalPlayTime: state.totalPlayTime, noiseOn: state.noiseOn,
    noiseVolume: state.noiseVolume, musicVolume: state.musicVolume,
    voiceInterval: state.voiceInterval,
    accent: state.accent, cardStyle: state.cardStyle,
  }));
}
function commitPlayTime(stop = true) {
  if (state.playStartTime > 0) {
    const now = Date.now();
    state.totalPlayTime += Math.max(0, (now - state.playStartTime) / 1000);
    state.playStartTime = stop ? 0 : now;
  }
  saveConfig();
}

// ============ 音量推子 ============
function applyMusicVolume(v) {
  state.musicVolume = Math.max(0, Math.min(1, v));
  audio.volume = state.musicVolume;
}
function initMixer() {
  const mv = $('#music-volume'), mvVal = $('#music-volume-val');
  if (mv) {
    mv.value = Math.round(state.musicVolume * 100);
    if (mvVal) mvVal.textContent = mv.value;
    mv.addEventListener('input', () => {
      if (mvVal) mvVal.textContent = mv.value;
      applyMusicVolume(+mv.value / 100);
    });
    mv.addEventListener('change', saveConfig);
  }
  const nv = $('#noise-volume'), nvVal = $('#noise-volume-val');
  if (nv) {
    nv.value = Math.round(state.noiseVolume * 100);
    if (nvVal) nvVal.textContent = nv.value;
    nv.addEventListener('input', () => {
      if (nvVal) nvVal.textContent = nv.value;
      setNoiseVolume(+nv.value / 100);
    });
    nv.addEventListener('change', saveConfig);
  }
}
applyMusicVolume(state.musicVolume);
initMixer();

// ============ 控制 ============
function playRandom() {
  const t = pickNext();
  if (t) playTrack(t);
}
function runWithLibrary(action) {
  if (state.tracks.length && !state.tracks.some(t => t.file)) {
    ensurePlayable().then(ok => { if (ok) action(); });
  } else {
    action();
  }
}
$('#btn-play').addEventListener('click', () => {
  cancelDial(false);
  if (state.mode === 'stream') {
    if (state.playing) { audio.pause(); state.playing = false; }
    else { audio.play().catch(() => {}); state.playing = true; }
    return;
  }
  if (!state.current) { runWithLibrary(playRandom); return; }
  if (state.playing) { audio.pause(); state.playing = false; }
  else { audio.play(); state.playing = true; }
});
$('#btn-next').addEventListener('click', () => { cancelDial(false); runWithLibrary(playRandom); });
$('#btn-prev').addEventListener('click', () => { cancelDial(false); runWithLibrary(playRandom); });
$('#btn-heart').addEventListener('click', () => {
  if (!state.current) return;
  state.current.fav = !state.current.fav;
  $('#btn-heart').classList.toggle('active', state.current.fav);
  const favName = state.current.name;
  const favFile = state.current.fileName || favName;
  if (state.current.fav) {
    state.favorites.add(favFile); state.favorites.add(favName);
  } else {
    state.favorites.delete(favFile); state.favorites.delete(favName);
  }
  localStorage.setItem('fm_favs', JSON.stringify([...state.favorites]));
});

// ============ 导入（覆盖 + 追加） ============
async function handleImport(append) {
  if (!('showDirectoryPicker' in window)) {
    $('#folder-input').click();
    return;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker();
  } catch (e) {
    $('#led').textContent = '已取消';
    return;
  }
  try {
    await saveDirHandle(handle);
    pendingDirHandle = handle;
    const newTracks = await tracksFromHandle(handle);

    // 授权失效时只恢复了索引，此时追加也按覆盖处理，避免留下无法播放的旧条目
    if (!append || state.tracks.some(t => !t.file)) {
      state.tracks = []; state.played = [];
    }

    const existingNames = new Set(state.tracks.map(t => t.name + t.path));
    let added = 0;
    for (const entry of newTracks) {
      if (!append || !existingNames.has(entry.name + entry.path)) {
        state.tracks.push(entry);
        existingNames.add(entry.name + entry.path);
        added++;
      }
    }

    saveLibraryIndex();
    $('#led').textContent = append ? `已追加 ${added} 首` : `已导入 ${state.tracks.length} 首`;
    refreshChannels();
    if (!state.current && state.tracks.length) playTrack(pickNext());
  } catch(e) {
    console.log('导入失败:', e);
    $('#led').textContent = '导入失败 · 请重新选择文件夹';
  }
}

$('#btn-import').addEventListener('click', () => handleImport(false));
$('#btn-append').addEventListener('click', () => handleImport(true));

$('#folder-input').addEventListener('change', e => {
  const files = [...e.target.files].filter(f => {
    const ext = f.name.toLowerCase().split('.').pop();
    return ['mp3','flac','wav','ogg','m4a','opus','aac'].includes(ext);
  });
  pendingDirHandle = null;
  state.tracks = files.map(f => ({
    name: f.name.replace(/\.[^.]+$/, ''), fileName: f.name, file: f,
    fav: isFavorite(f.name.replace(/\.[^.]+$/, ''), f.name), path: f.webkitRelativePath || '',
  }));
  state.played = [];
  saveLibraryIndex();
  $('#led').textContent = `已导入 ${state.tracks.length} 首`;
  refreshChannels();
});

async function scanDirectory(dir, list) {
  const exts = ['.mp3','.flac','.wav','.ogg','.m4a','.opus','.aac'];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      const lower = name.toLowerCase();
      if (exts.some(e => lower.endsWith(e))) list.push(handle);
    } else if (handle.kind === 'directory') {
      await scanDirectory(handle, list);
    }
  }
}

async function tracksFromHandle(dir) {
  const handles = [];
  await scanDirectory(dir, handles);
  const tracks = [];
  for (const handle of handles) {
    const file = await handle.getFile();
    tracks.push({
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      file,
      fav: isFavorite(file.name.replace(/\.[^.]+$/, ''), file.name),
      path: '',
    });
  }
  return tracks;
}

let pendingDirHandle = null;
let restoringLibrary = false;

async function restoreLibrary(handle, requestPermission = false) {
  if (!handle || restoringLibrary) return false;
  restoringLibrary = true;
  try {
    let perm = 'granted';
    if (requestPermission && handle.requestPermission) {
      perm = await handle.requestPermission({ mode: 'read' });
    } else if (handle.queryPermission) {
      perm = await handle.queryPermission({ mode: 'read' });
    }
    if (perm !== 'granted') {
      pendingDirHandle = handle;
      $('#led').textContent = state.tracks.length
        ? `上次曲库 ${state.tracks.length} 首 · 点击播放恢复`
        : '点击播放恢复上次曲库';
      return false;
    }
    const tracks = await tracksFromHandle(handle);
    state.tracks = tracks;
    state.played = [];
    pendingDirHandle = null;
    saveLibraryIndex();
    refreshChannels();
    refreshDuration();
    $('#led').textContent = `已自动恢复 ${tracks.length} 首`;
    return true;
  } catch (e) {
    console.log('恢复失败:', e);
    pendingDirHandle = handle;
    $('#led').textContent = '曲库恢复失败 · 请重新导入文件夹';
    return false;
  } finally {
    restoringLibrary = false;
  }
}

async function ensurePlayable() {
  if (state.tracks.some(t => t.file)) return true;
  if (pendingDirHandle) {
    const ok = await restoreLibrary(pendingDirHandle, true);
    return ok && state.tracks.some(t => t.file);
  }
  if (state.tracks.length) {
    $('#led').textContent = '曲库文件未授权 · 请重新导入文件夹';
  }
  return false;
}

// ============ 频道 + 网络串流按键 ============

// 按 data-ch / data-key 找到对应按键（键位统一用字符串）
function getKeyButton(key) {
  return document.querySelector(`.key[data-ch="${key}"], .key[data-key="${key}"]`);
}

// 统一维护按键下方的小字标签
function setKeySmall(btn, text, visible = true) {
  let el = btn.querySelector('small');
  if (!text) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('small'); btn.appendChild(el); }
  if (el.textContent !== text) el.textContent = text;
  el.style.display = visible ? '' : 'none';
}

// * / 0 / # 三个键：绑定了流就显示流名，否则恢复占位样式（# 为点歌键）
function refreshStreamKeys() {
  document.querySelectorAll('.key[data-key]').forEach(k => {
    const key = k.dataset.key;
    if (key === '#') {
      k.classList.remove('streaming');
      k.removeAttribute('title');
      k.setAttribute('aria-label', '井号键：按序号点歌，再按一次确认');
      setKeySmall(k, '点歌');
      return;
    }
    const s = state.streams[key];
    k.classList.toggle('streaming', !!s);
    if (s) {
      k.title = s.url;
      k.setAttribute('aria-label', `网络串流：${s.name}`);
      setKeySmall(k, s.name);
    } else {
      k.removeAttribute('title');
      k.setAttribute('aria-label', `${key} 键，暂未开放`);
      setKeySmall(k, '');
    }
  });
}

function refreshChannels() {
  const unlocked = state.tracks.length > UNLOCK_TRACKS;
  document.querySelectorAll('.key[data-ch]').forEach(k => {
    const ch = +k.dataset.ch;
    const key = k.dataset.ch;
    const s = state.streams[key];

    // 绑定了网络串流：该键专职播流，不再受解锁限制
    if (s) {
      k.classList.remove('locked');
      k.classList.add('streaming');
      k.title = s.url;
      setKeySmall(k, s.name);
      return;
    }

    k.classList.remove('streaming');
    k.removeAttribute('title');
    if (ch <= 2) { setKeySmall(k, ch === 1 ? '随机' : '红心'); return; }
    k.classList.toggle('locked', !unlocked);
    setKeySmall(k, '待解锁', !unlocked);
  });

  // 曲库变少导致当前频道被锁定时，退回 CH1（绑定串流的键除外）
  if (!unlocked && typeof state.ch === 'number' && state.ch > 2 && !state.streams[String(state.ch)]) {
    state.ch = 1;
    state.played = [];
    document.querySelectorAll('.key[data-ch]').forEach(b => {
      b.classList.toggle('active', b.dataset.ch === '1');
    });
    const dashCh = $('#dash-ch');
    if (dashCh) dashCh.textContent = '1';
  }

  // 常驻显示已导入数量与可选序号范围
  const libCount = $('#lib-count');
  if (libCount) {
    libCount.textContent = state.tracks.length
      ? `已导入 ${state.tracks.length} 首 · 选号 ${state.tracks.length >= 3 ? `3–${state.tracks.length}` : '不可用（需 3 首以上）'}`
      : '尚未导入曲目';
  }
}

function activateChannel(btn, ch) {
  state.mode = 'local'; state.streamKey = null;
  state.ch = ch; state.played = [];
  document.querySelectorAll('.key[data-ch], .key[data-key]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const dashCh = $('#dash-ch');
  if (dashCh) dashCh.textContent = String(ch);
  $('#led').textContent = `CH${ch} · 已切换`;
  const t = pickNext(); if (t) playTrack(t);
}

// 播放网络串流（直播流：无时长、ended 不自动切歌）
function playStream(key, stream) {
  if (!stream || !stream.url) return;
  state.mode = 'stream';
  state.streamKey = key;
  state.current = null;        // 当前不是本地曲目
  state.ch = key;              // 数码屏显示绑定的键位
  state.playing = true;

  const dashCh = $('#dash-ch');
  if (dashCh) dashCh.textContent = key;
  document.querySelectorAll('.key[data-ch], .key[data-key]').forEach(b => b.classList.remove('active'));
  const btn = getKeyButton(key);
  if (btn) btn.classList.add('active');

  audio.volume = state.musicVolume;
  audio.src = stream.url;
  audio.play().catch(e => {
    console.log('网络串流播放失败:', e);
    state.playing = false;
    $('#led').textContent = '串流播放失败 · 请检查地址';
  });

  $('#track-title').textContent = stream.name;
  $('#track-sub').textContent = `${isNumericStreamKey(key) ? `${key} 号` : `${key} 键`} · 网络直播`;
  $('#btn-heart').classList.remove('active');
  const bar = $('#progress-bar');
  if (bar) bar.style.width = '100%';
  $('#led').textContent = `网络串流 · ${stream.name}`;
}

// ============ 按序号点歌 / 选台（# → 数字 → #）============
// 序号 1 起算、按导入顺序；1（随机）/ 2（红心）恒不可选，有效范围 3 ~ tracks.length
// 输入的数字若已绑定网络串流（含 3-9 与 10-9999），优先播放串流，否则按序号点歌
function hasNumericStreams() {
  return Object.keys(state.streams).some(isNumericStreamKey);
}

function dialHintText() {
  const parts = [];
  if (state.tracks.length >= 3) parts.push(`3–${state.tracks.length} 点歌`);
  if (hasNumericStreams()) parts.push('已绑定串流编号');
  return parts.length ? parts.join(' / ') : '暂无可用编号';
}

function renderDash() {
  const dashCh = $('#dash-ch');
  if (!dashCh) return;
  dashCh.textContent = state.mode === 'stream' ? String(state.streamKey) : String(state.ch);
}

function renderDial() {
  const dashCh = $('#dash-ch');
  if (dashCh) dashCh.textContent = dial.buf ? `#${dial.buf}` : '#';
  const hashKey = getKeyButton('#');
  if (hashKey) hashKey.classList.add('dialing');
}

function armDialTimer() {
  if (dial.timer) clearTimeout(dial.timer);
  dial.timer = setTimeout(() => cancelDial(false), DIAL_TIMEOUT);
}

function cancelDial(silent = true) {
  if (!dial.active) return;
  dial.active = false;
  dial.buf = '';
  if (dial.timer) { clearTimeout(dial.timer); dial.timer = 0; }
  const hashKey = getKeyButton('#');
  if (hashKey) hashKey.classList.remove('dialing');
  renderDash();
  if (!silent) $('#led').textContent = '已取消选号';
}

function startDial() {
  if (dial.active) return;
  if (state.tracks.length < 3 && !hasNumericStreams()) {
    $('#led').textContent = '曲目不足 3 首 · 无法按序号点歌';
    return;
  }
  dial.active = true;
  dial.buf = '';
  renderDial();
  $('#led').textContent = `选号：输入 ${dialHintText()} · 按 # 确认`;
  armDialTimer();
}

function dialDigit(d) {
  if (!dial.active) return;
  if (dial.buf.length >= MAX_DIAL_DIGITS) return;
  if (dial.buf === '' && d === '0') return;   // 序号不以 0 开头
  dial.buf += d;
  renderDial();
  $('#led').textContent = `选号：#${dial.buf} · 按 # 确认`;
  armDialTimer();
}

function jumpToTrack(n) {
  const t = state.tracks[n - 1];
  if (!t) return;
  cancelDial(true);
  const wanted = t.fileName || t.name;

  const play = target => {
    if (!target || !target.file) { $('#led').textContent = '目标曲目不可用'; return; }
    playTrack(target);
    $('#track-sub').textContent = `第 ${n} 首`;
    $('#led').textContent = `跳转到第 ${n} 首 · ${target.name}`;
  };

  if (t.file) { play(t); return; }
  // 授权失效时先恢复文件夹，再按文件名找回目标曲目
  ensurePlayable().then(ok => {
    if (!ok) return;
    const target = state.tracks.find(x => (x.fileName || x.name) === wanted) || state.tracks[n - 1];
    play(target);
  });
}

function confirmDial() {
  if (!dial.active) return;
  if (!dial.buf) {
    $('#led').textContent = `请先输入编号（${dialHintText()}）`;
    armDialTimer();
    return;
  }
  const n = parseInt(dial.buf, 10);
  if (!Number.isFinite(n)) {
    $('#led').textContent = `编号无效 · ${dialHintText()}`;
    dial.buf = '';
    renderDial();
    armDialTimer();
    return;
  }
  // 串流优先：该编号绑定了网络串流就直接播放
  const key = String(n);
  const stream = state.streams[key];
  if (stream) {
    cancelDial(true);
    playStream(key, stream);
    return;
  }
  if (n < 3 || n > state.tracks.length) {
    $('#led').textContent = `序号无效 · ${dialHintText()}`;
    dial.buf = '';
    renderDial();
    armDialTimer();
    return;
  }
  jumpToTrack(n);
}

function handleHashKey() {
  if (dial.active) confirmDial();
  else startDial();
}

// ============ 彩蛋：数字键连击 ============
function resetEggBuffer() {
  eggBuf = '';
  if (eggTimer) { clearTimeout(eggTimer); eggTimer = 0; }
}

function openEasterEgg() {
  cancelDial(true);
  $('#led').textContent = '彩蛋已触发 · 正在打开…';
  try {
    const win = window.open(EGG_URL, '_blank', 'noopener,noreferrer');
    if (win) win.opener = null;
  } catch (e) { console.log('彩蛋打开失败:', e); }
}

function recordEggDigit(d) {
  if (!/^[0-9]$/.test(d)) return false;
  eggBuf = (eggBuf + d).slice(-8);   // 只需保留最近 8 位
  if (eggTimer) clearTimeout(eggTimer);
  eggTimer = setTimeout(resetEggBuffer, EGG_TIMEOUT);
  if (EGG_CODES.some(code => eggBuf.endsWith(code))) {
    resetEggBuffer();
    openEasterEgg();
    return true;
  }
  return false;
}

document.querySelectorAll('.key[data-ch]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.ch;
    if (recordEggDigit(key)) return;   // 彩蛋命中则终止常规处理

    // 选号态下 1-9 作为数字位（不切频道）
    if (dial.active) { dialDigit(key); return; }

    const stream = state.streams[key];
    if (stream) { playStream(key, stream); return; }

    const ch = +key;
    if (ch > 2 && state.tracks.length <= UNLOCK_TRACKS) {
      $('#led').textContent = `CH3-9 待解锁 · 需超过 ${UNLOCK_TRACKS} 首`;
      return;
    }
    runWithLibrary(() => activateChannel(btn, ch));
  });
});

// 数字键盘 * / 0 / #：# 为点歌键；选号态下 * 取消、0 作为数字位
document.querySelectorAll('.key[data-key]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (recordEggDigit(key)) return;   // 0 也参与彩蛋连击
    if (key === '#') { handleHashKey(); return; }
    if (dial.active) {
      if (key === '*') { cancelDial(false); return; }
      if (key === '0') { dialDigit('0'); return; }
    }
    const stream = state.streams[key];
    if (stream) { playStream(key, stream); return; }
    $('#led').textContent = `${key} 键暂未开放`;
  });
});

// ============ 设置面板 ============
$('#btn-settings').addEventListener('click', () => {
  const old = document.querySelector('.sheet-mask');
  if (old) old.remove();
  const mask = document.createElement('div');
  mask.className = 'sheet-mask show';
  mask.innerHTML = `
    <div class="sheet">
      <h3>设置</h3>
      <div class="row">
        <span>主题色</span>
        <div id="theme-colors" style="display:flex;gap:6px;">
          ${THEME_COLORS.map(c =>
            `<span class="theme-dot${c===state.accent?' active':''}" data-color="${c}" style="background:${c}"></span>`
          ).join('')}
        </div>
      </div>
      <div class="row">
        <span>界面主题</span>
        <select id="s-theme">
          <option value="dark"${state.cardStyle==='dark'?' selected':''}>默认 · 黑底橙字</option>
          <option value="led"${state.cardStyle==='led'?' selected':''}>LED · 灰底黑字</option>
          <option value="crt"${state.cardStyle==='crt'?' selected':''}>冷光绿 · 示波器</option>
          <option value="cream"${state.cardStyle==='cream'?' selected':''}>暖白奶油 · 卡带机</option>
          <option value="tube"${state.cardStyle==='tube'?' selected':''}>暗红琥珀 · 真空管</option>
        </select>
      </div>
      <div class="row">
        <span>底噪</span>
        <select id="s-noise">
          <option value="on"${state.noiseOn?' selected':''}>开启</option>
          <option value="off"${!state.noiseOn?' selected':''}>关闭</option>
        </select>
      </div>
      <div class="row">
        <span>口播间隔（首）</span>
        <input id="s-voice" type="number" min="0" max="99" value="${state.voiceInterval}" style="width:60px;">
      </div>
      <div class="row stream-head">
        <span>网络串流</span>
        <span class="stream-cap" id="s-stream-cap"></span>
        <button type="button" id="s-stream-add" class="mini-btn">＋ 添加</button>
      </div>
      <div id="s-stream-list" class="stream-list"></div>
      <div id="s-stream-form" class="stream-form" style="display:none;">
        <input id="s-stream-name" type="text" placeholder="名称，如 城市爵士" maxlength="40">
        <input id="s-stream-url" type="text" placeholder="https://example.com/live.mp3" autocomplete="off" spellcheck="false">
        <input id="s-stream-key" type="text" placeholder="按键/编号：3–9、*、0 或 10–9999（留空自动分配）" maxlength="4" autocomplete="off" spellcheck="false">
        <div class="stream-form-actions">
          <button type="button" id="s-stream-save" class="mini-btn">确认添加</button>
          <button type="button" id="s-stream-cancel" class="mini-btn ghost">取消</button>
        </div>
        <div id="s-stream-err" class="stream-err"></div>
      </div>
      <button id="s-close" style="width:100%;margin-top:20px;padding:12px;background:var(--accent);color:var(--bg);border:none;border-radius:10px;font-size:14px;cursor:pointer;">完成</button>
    </div>`;
  document.body.appendChild(mask);

  mask.querySelectorAll('.theme-dot').forEach(dot => {
    dot.addEventListener('click', () => setAccent(dot.dataset.color));
  });

  // ---- 网络串流编辑（面板内用临时副本，点「完成」才提交） ----
  const draft = JSON.parse(JSON.stringify(state.streams));
  const listEl = mask.querySelector('#s-stream-list');
  const formEl = mask.querySelector('#s-stream-form');
  const keyInp = mask.querySelector('#s-stream-key');
  const nameInp = mask.querySelector('#s-stream-name');
  const urlInp = mask.querySelector('#s-stream-url');
  const errEl = mask.querySelector('#s-stream-err');
  const addBtn = mask.querySelector('#s-stream-add');
  const capEl = mask.querySelector('#s-stream-cap');

  // 优先分配空闲实体键，用完后从 10 起找最小空闲编号
  function nextFreeStreamKey() {
    for (const k of STREAM_KEYS) if (!draft[k]) return k;
    for (let n = 10; n <= MAX_STREAM_NUM; n++) if (!draft[String(n)]) return String(n);
    return '';
  }

  function renderStreams() {
    const keys = sortStreamKeys(Object.keys(draft));
    listEl.innerHTML = keys.length ? keys.map(k => `
      <div class="stream-item">
        <span class="stream-key">${k}</span>
        <span class="stream-meta">
          <b>${escapeHtml(draft[k].name)}</b>
          <i>${escapeHtml(draft[k].url)}</i>
        </span>
        <button type="button" class="stream-del" data-key="${k}">删除</button>
      </div>`).join('')
      : '<div class="stream-empty">还没有网络串流，点右上角「＋ 添加」</div>';

    if (capEl) capEl.textContent = `${keys.length} / ${MAX_STREAMS}`;
    addBtn.disabled = keys.length >= MAX_STREAMS;
  }

  listEl.addEventListener('click', e => {
    const b = e.target.closest('.stream-del');
    if (!b) return;
    delete draft[b.dataset.key];
    renderStreams();
  });

  addBtn.addEventListener('click', () => {
    if (Object.keys(draft).length >= MAX_STREAMS) return;
    formEl.style.display = 'flex';
    errEl.textContent = '';
    nameInp.value = '';
    urlInp.value = '';
    keyInp.value = nextFreeStreamKey();
    nameInp.focus();
  });

  mask.querySelector('#s-stream-save').addEventListener('click', () => {
    const name = nameInp.value.trim();
    const url = urlInp.value.trim();
    const rawKey = keyInp.value;
    if (!name) { errEl.textContent = '请填写流名称'; return; }
    if (!/^https?:\/\//i.test(url)) { errEl.textContent = '流地址需以 http:// 或 https:// 开头'; return; }
    let key = parseStreamKey(rawKey);
    if (!key && !rawKey.trim()) key = nextFreeStreamKey();
    if (!key) { errEl.textContent = '按键需为 3–9、*、0，或 3–9999 的编号（1/2 保留）'; return; }
    if (draft[key]) { errEl.textContent = `编号 ${key} 已被占用，请先删除或换一个`; return; }
    if (Object.keys(draft).length >= MAX_STREAMS) {
      errEl.textContent = `最多保存 ${MAX_STREAMS} 条串流地址`;
      return;
    }
    draft[key] = { name: name.slice(0, 40), url };
    formEl.style.display = 'none';
    errEl.textContent = '';
    renderStreams();
  });

  mask.querySelector('#s-stream-cancel').addEventListener('click', () => {
    formEl.style.display = 'none';
    errEl.textContent = '';
  });

  renderStreams();

  const prevStyle = state.cardStyle, prevAccent = state.accent;
  $('#s-theme').addEventListener('change', e => {
    state.cardStyle = e.target.value;
    applyTheme(true);   // 实时预览
  });

  $('#s-close').onclick = () => {
    state.noiseOn = $('#s-noise').value === 'on';
    state.voiceInterval = +$('#s-voice').value;
    state.streams = draft;
    saveStreams();
    refreshChannels();
    refreshStreamKeys();
    // 正在播放的串流被删除：直接停止并回到 CH1
    if (state.mode === 'stream' && !state.streams[state.streamKey]) {
      audio.pause();
      state.playing = false;
      state.mode = 'local';
      state.streamKey = null;
      state.ch = 1;
      state.played = [];
      document.querySelectorAll('.key[data-ch], .key[data-key]').forEach(b => b.classList.remove('active'));
      const k1 = getKeyButton('1');
      if (k1) k1.classList.add('active');
      const dashCh = $('#dash-ch');
      if (dashCh) dashCh.textContent = '1';
      $('#track-sub').textContent = '网络串流已移除';
    }
    if (state.noiseOn && state.playing) startNoise(); else stopNoise();
    saveConfig(); mask.remove();
  };
  mask.addEventListener('click', e => {
    if (e.target === mask) {
      // 没有点“完成”就关闭：回滚主题与强调色
      state.cardStyle = prevStyle;
      state.accent = prevAccent;
      applyTheme();
      mask.remove();
    }
  });
});

// ============ 键盘 ============
const KEYPAD_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); return; }
  if (e.code === 'ArrowRight') { $('#btn-next').click(); return; }
  if (e.code === 'ArrowLeft') { $('#btn-prev').click(); return; }

  // 数字键 / * / # 映射到屏幕按键（含绑定的网络串流）
  if (KEYPAD_KEYS.includes(e.key)) {
    const btn = getKeyButton(e.key);
    if (btn) { e.preventDefault(); btn.click(); }
  }
});

// ============ Service Worker ============
// file:// 下浏览器不允许注册 SW，仅 http(s) 或 localhost 生效
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            const led = $('#led');
            if (led) led.textContent = '新版本已就绪 · 刷新后生效';
          }
        });
      });
    }).catch(e => console.log('SW 注册失败:', e));
  });
}
