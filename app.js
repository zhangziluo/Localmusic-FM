const $ = s => document.querySelector(s);

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

// ============ 状态 ============
const state = {
  tracks: [], played: [], current: null, playing: false,
  noiseOn: false, noiseType: 'pink', noiseVolume: 0.85, voiceInterval: 0,
  totalPlayTime: 0, playStartTime: 0,
  ch: 1, accent: '#ff8c42', cardStyle: 'dark',
  favorites: new Set(),
};

// ============ 初始化 ============
(async function init() {
  const cfg = JSON.parse(localStorage.getItem('fm_config') || '{}');
  state.totalPlayTime = cfg.totalPlayTime || 0;
  state.noiseOn = cfg.noiseOn || false;
  state.noiseType = cfg.noiseType || 'pink';
  if (!['pink', 'brown', 'static'].includes(state.noiseType)) state.noiseType = 'pink';
  state.noiseVolume = typeof cfg.noiseVolume === 'number'
    ? Math.max(0, Math.min(1, cfg.noiseVolume)) : 0.85;
  state.voiceInterval = cfg.voiceInterval || 0;
  state.accent = cfg.accent || '#ff8c42';
  state.cardStyle = cfg.cardStyle || 'dark';
  const favs = JSON.parse(localStorage.getItem('fm_favs') || '[]');
  state.favorites = new Set(favs);

  document.documentElement.style.setProperty('--accent', state.accent);
  const dash = $('#dashboard');
  if (dash) dash.className = `theme-${state.cardStyle}`;

  // 恢复文件夹
  try {
    await initDB();
    const savedHandle = await loadDirHandle();
    if (savedHandle) {
      let permitted = false;
      if (savedHandle.queryPermission) {
        permitted = await savedHandle.queryPermission({ mode: 'read' }) === 'granted';
        if (!permitted) permitted = await savedHandle.requestPermission({ mode: 'read' }) === 'granted';
      }
      if (permitted) {
        state.tracks = []; state.played = [];
        await scanDirectory(savedHandle);
        $('#led').textContent = `已自动恢复 ${state.tracks.length} 首`;
        refreshChannels();
      }
    }
  } catch (e) { console.log('恢复失败:', e); }
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
}
updateClock(); setInterval(updateClock, 1000);

// ============ 时长 ============
function fmtDuration(sec) {
  const h = String(Math.floor(sec/3600)).padStart(2,'0');
  const m = String(Math.floor((sec%3600)/60)).padStart(2,'0');
  const s = String(Math.floor(sec%60)).padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function refreshDuration() {
  let cur = state.totalPlayTime;
  if (state.playing && state.playStartTime > 0) cur += (Date.now() - state.playStartTime)/1000;
  const el = $('#dash-dur');
  if (el) el.textContent = fmtDuration(cur);
}
setInterval(refreshDuration, 1000);

// ============ 音频 ============
const audio = new Audio();

// ---- 底噪合成（Web Audio，无需外部音频文件） ----
const NOISE_TARGET_RMS = 0.08;   // 统一响度（RMS）
const NOISE_TRIM = { pink: 1, brown: 1, static: 0.85 };
let noiseCtx = null, noiseGain = null, noiseSrc = null;
const noiseBuffers = {};

function ensureNoiseCtx() {
  if (!noiseCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    noiseCtx = new AC();
    noiseGain = noiseCtx.createGain();
    noiseGain.gain.value = 0;
    noiseGain.connect(noiseCtx.destination);
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

// 生成 4 秒、首尾交叉淡化的可循环噪声缓冲
function getNoiseBuffer(type) {
  const ctx = ensureNoiseCtx();
  if (!ctx) return null;
  const key = ctx.sampleRate + ':' + type;
  if (noiseBuffers[key]) return noiseBuffers[key];

  const sr = ctx.sampleRate;
  const loopLen = Math.floor(sr * 4);
  const fade = Math.floor(sr * 0.15);
  const raw = new Float32Array(loopLen + fade);

  if (type === 'pink') {
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
  } else if (type === 'brown') {
    // 棕色噪声：白噪声泄漏积分（-6dB/oct）
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last * 3.5;
    }
  } else {
    // 电台沙沙声：带通白噪声 + 随机干扰爆音 + 信号起伏
    let low = 0, smooth = 0, drift = 0, crackle = 0, decay = 0;
    const hpA = 1 - Math.exp(-2 * Math.PI * 350 / sr);   // 高通 ~350Hz
    const lpA = 1 - Math.exp(-2 * Math.PI * 7000 / sr);  // 低通 ~7kHz
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      low += hpA * (w - low);
      let s = w - low;                  // 高通：去掉低频轰隆
      smooth += lpA * (s - smooth);     // 低通：柔化高频、更像收音机
      s = smooth;

      // 缓慢的信号漂移，让沙沙声有呼吸感
      drift += 0.00002 * (Math.random() * 2 - 1);
      drift *= 0.99995;
      s *= 1 + Math.max(-0.25, Math.min(0.25, drift));

      // 随机“啪”的干扰爆音，指数衰减约 8ms
      if (crackle === 0 && Math.random() < 0.0001) {
        crackle = (Math.random() * 0.6 + 0.4) * (Math.random() < 0.5 ? -1 : 1);
        decay = 1 - Math.exp(-1 / (sr * 0.008));
      }
      if (crackle !== 0) {
        s += crackle;
        crackle -= crackle * decay;
        if (Math.abs(crackle) < 0.001) crackle = 0;
      }
      raw[i] = s;
    }
  }

  // 归一化到统一 RMS，三种底噪响度接近
  let sum = 0;
  for (let i = 0; i < raw.length; i++) sum += raw[i] * raw[i];
  const rms = Math.sqrt(sum / raw.length) || 1;
  const scale = NOISE_TARGET_RMS * (NOISE_TRIM[type] || 1) / rms;
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
  const buffer = getNoiseBuffer(state.noiseType);
  if (!buffer) return;
  noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = buffer;
  noiseSrc.loop = true;
  noiseSrc.connect(noiseGain);
  noiseSrc.start();
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
}

// 切换类型：先淡出旧底噪，再淡入新类型
function restartNoise() {
  if (!state.noiseOn || !state.playing) { stopNoise(); return; }
  if (!noiseSrc) { startNoise(); return; }
  stopNoise(0.18);
  setTimeout(() => {
    if (state.noiseOn && state.playing && !noiseSrc) startNoise();
  }, 220);
}

// 调节底噪音量（0~1）：播放中实时平滑过渡，未播放时只记状态
function setNoiseVolume(v) {
  state.noiseVolume = Math.max(0, Math.min(1, v));
  if (!noiseCtx || !noiseGain || !noiseSrc) return;
  const t = noiseCtx.currentTime;
  noiseGain.gain.cancelScheduledValues(t);
  noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
  noiseGain.gain.linearRampToValueAtTime(state.noiseVolume, t + 0.12);
}

audio.addEventListener('play', () => {
  state.playStartTime = Date.now();
  const icon = $('#icon-play');
  if (icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
  if (state.noiseOn) startNoise();
});
audio.addEventListener('pause', () => {
  if (state.playStartTime > 0) {
    state.totalPlayTime += (Date.now() - state.playStartTime)/1000;
    state.playStartTime = 0; saveConfig();
  }
  const icon = $('#icon-play');
  if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  stopNoise();
});
audio.addEventListener('ended', () => {
  if (state.playStartTime > 0) {
    state.totalPlayTime += (Date.now() - state.playStartTime)/1000;
    state.playStartTime = 0; saveConfig();
  }
  playTrack(pickNext());
});
audio.addEventListener('timeupdate', () => {
  if (audio.duration && isFinite(audio.duration)) {
    $('#progress-bar').style.width = (audio.currentTime / audio.duration * 100) + '%';
  }
});

function pickNext() {
  if (!state.tracks.length) return null;
  if (state.ch === 2) {
    const favs = state.tracks.filter(t => t.fav);
    if (!favs.length) return state.tracks[Math.floor(Math.random()*state.tracks.length)];
    return favs[Math.floor(Math.random()*favs.length)];
  }
  return state.tracks[Math.floor(Math.random() * state.tracks.length)];
}
function playTrack(t) {
  if (!t) return;
  state.current = t;
  audio.src = URL.createObjectURL(t.file);
  audio.play();
  state.playing = true;
  $('#track-title').textContent = t.name;
  $('#track-sub').textContent = `CH${state.ch}`;
  $('#btn-heart').classList.toggle('active', !!t.fav);
}

function saveConfig() {
  localStorage.setItem('fm_config', JSON.stringify({
    totalPlayTime: state.totalPlayTime, noiseOn: state.noiseOn,
    noiseType: state.noiseType, voiceInterval: state.voiceInterval,
    noiseVolume: state.noiseVolume,
    accent: state.accent, cardStyle: state.cardStyle,
  }));
}

// ============ 控制 ============
$('#btn-play').addEventListener('click', () => {
  if (!state.current) { const t = pickNext(); if (t) playTrack(t); return; }
  if (state.playing) { audio.pause(); state.playing = false; }
  else { audio.play(); state.playing = true; }
});
$('#btn-next').addEventListener('click', () => { const t = pickNext(); if (t) playTrack(t); });
$('#btn-prev').addEventListener('click', () => { const t = pickNext(); if (t) playTrack(t); });
$('#btn-heart').addEventListener('click', () => {
  if (!state.current) return;
  state.current.fav = !state.current.fav;
  $('#btn-heart').classList.toggle('active', state.current.fav);
  if (state.current.fav) state.favorites.add(state.current.name);
  else state.favorites.delete(state.current.name);
  localStorage.setItem('fm_favs', JSON.stringify([...state.favorites]));
});

// ============ 导入（覆盖 + 追加） ============
async function handleImport(append) {
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker();
      await saveDirHandle(handle);
      const newTracks = [];
      await scanDirectory(handle, newTracks);

      if (!append) { state.tracks = []; state.played = []; }

      const existingNames = new Set(state.tracks.map(t => t.name + t.path));
      let added = 0;
      for (const item of newTracks) {
        const file = await item.getFile();
        const entry = { name: file.name.replace(/\.[^.]+$/, ''), file, fav: state.favorites.has(file.name), path: item.path || '' };
        if (!append || !existingNames.has(entry.name + entry.path)) {
          state.tracks.push(entry);
          existingNames.add(entry.name + entry.path);
          added++;
        }
      }

      $('#led').textContent = append ? `已追加 ${added} 首` : `已导入 ${state.tracks.length} 首`;
      refreshChannels();
      if (!state.current && state.tracks.length) playTrack(pickNext());
    } catch(e) { $('#led').textContent = '已取消'; }
  } else {
    $('#folder-input').click();
  }
}

$('#btn-import').addEventListener('click', () => handleImport(false));
$('#btn-append').addEventListener('click', () => handleImport(true));

$('#folder-input').addEventListener('change', e => {
  const files = [...e.target.files].filter(f => {
    const ext = f.name.toLowerCase().split('.').pop();
    return ['mp3','flac','wav','ogg','m4a','opus','aac'].includes(ext);
  });
  state.tracks = files.map(f => ({ name: f.name.replace(/\.[^.]+$/, ''), file: f, fav: state.favorites.has(f.name) }));
  state.played = [];
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

// ============ 频道 ============
function refreshChannels() {
  const ok = state.tracks.length >= 100;
  document.querySelectorAll('.key').forEach(k => {
    const ch = +k.dataset.ch;
    if (ch > 2) k.classList.toggle('locked', !ok);
  });
}
document.querySelectorAll('.key').forEach(btn => {
  btn.addEventListener('click', () => {
    const ch = +btn.dataset.ch;
    if (ch > 2 && state.tracks.length < 100) { $('#led').textContent = '频道 3-9 需 ≥100 首解锁'; return; }
    state.ch = ch; state.played = [];
    document.querySelectorAll('.key').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const chLabel = btn.querySelector('small') ? btn.querySelector('small').innerText : '';
    const dashCh = $('#dash-ch');
    if (dashCh) dashCh.textContent = `${ch} ${chLabel}`;
    $('#led').textContent = `CH${ch} · 已切换`;
    const t = pickNext(); if (t) playTrack(t);
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
          ${['#ff8c42','#42c02e','#007bff','#8b5cf6','#ec4899','#ef4444','#06b6d4','#6b7280'].map(c =>
            `<span class="theme-dot" data-color="${c}" style="background:${c}${c===state.accent?';border-color:#333;transform:scale(1.15)':''}"></span>`
          ).join('')}
        </div>
      </div>
      <div class="row">
        <span>数据卡片</span>
        <select id="s-card-style">
          <option value="dark"${state.cardStyle==='dark'?' selected':''}>黑底橙字</option>
          <option value="led"${state.cardStyle==='led'?' selected':''}>LED灰底黑字</option>
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
        <span>底噪类型</span>
        <select id="s-type">
          <option value="pink"${state.noiseType==='pink'?' selected':''}>粉红噪声</option>
          <option value="brown"${state.noiseType==='brown'?' selected':''}>棕色噪声</option>
          <option value="static"${state.noiseType==='static'?' selected':''}>电台沙沙声</option>
        </select>
      </div>
      <div class="row">
        <span>底噪音量</span>
        <div class="noise-vol">
          <input id="s-volume" type="range" min="0" max="100" step="1" value="${Math.round(state.noiseVolume * 100)}">
          <b id="s-volume-val">${Math.round(state.noiseVolume * 100)}%</b>
        </div>
      </div>
      <div class="row">
        <span>口播间隔（首）</span>
        <input id="s-voice" type="number" min="0" max="99" value="${state.voiceInterval}" style="width:60px;">
      </div>
      <button id="s-close" style="width:100%;margin-top:20px;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">完成</button>
    </div>`;
  document.body.appendChild(mask);

  mask.querySelectorAll('.theme-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      state.accent = dot.dataset.color;
      document.documentElement.style.setProperty('--accent', state.accent);
      mask.querySelectorAll('.theme-dot').forEach(d => { d.style.borderColor='transparent'; d.style.transform='scale(1)'; });
      dot.style.borderColor = '#333'; dot.style.transform = 'scale(1.15)';
    });
  });

  const volEl = $('#s-volume'), volVal = $('#s-volume-val');
  volEl.addEventListener('input', () => {
    volVal.textContent = volEl.value + '%';
    setNoiseVolume(+volEl.value / 100);
  });
  volEl.addEventListener('change', saveConfig);

  $('#s-close').onclick = () => {
    const prevType = state.noiseType;
    state.noiseOn = $('#s-noise').value === 'on';
    state.noiseType = $('#s-type').value;
    state.noiseVolume = Math.max(0, Math.min(1, +$('#s-volume').value / 100));
    setNoiseVolume(state.noiseVolume);
    state.voiceInterval = +$('#s-voice').value;
    state.cardStyle = $('#s-card-style').value;
    const dash = $('#dashboard');
    if (dash) dash.className = `theme-${state.cardStyle}`;
    if (state.noiseOn && state.playing) {
      if (prevType !== state.noiseType) restartNoise(); else startNoise();
    } else stopNoise();
    saveConfig(); mask.remove();
  };
  mask.addEventListener('click', e => { if (e.target === mask) mask.remove(); });
});

// ============ 键盘 ============
document.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); }
  if (e.code === 'ArrowRight') $('#btn-next').click();
  if (e.code === 'ArrowLeft') $('#btn-prev').click();
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
