/* ============================================================
   NekoConvert — Lógica de conversão (100% client-side)
   by Neko Studios
   ============================================================ */

// Configura PDF.js worker
if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ====== Estado ======
const state = {
  mode: 'image',
  files: [],     // [{id, file, kind, name, size, thumb, status, progress}]
  results: [],   // [{name, blob, originalSize, newSize, mime}]
};

// ====== Utilitários ======
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 9);

const fmtBytes = (b) => {
  if (b < 1024) return b + ' B';
  if (b < 1024 ** 2) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(2) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
};

const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', '3gp', 'flv', 'wmv', 'ogv'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'aiff', 'aif', 'wma'];
const IMAGE_ACCEPT = 'image/*,application/pdf,.svg,.ico,.bmp,.webp,.gif,.heic';
const VIDEO_ACCEPT = 'video/*,audio/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.mpeg,.mpg,.3gp,.flv,.wmv,.ogv,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.aiff,.aif,.wma';
const AUDIO_TARGETS = ['mp3', 'm4a', 'aac', 'wav', 'ogg'];
const VIDEO_TARGETS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
const REMUX_TARGETS = ['mp4', 'mov', 'm4v', 'mkv'];
const FFMPEG_LIB_SOURCES = [
  {
    ffmpegURL: 'vendor/ffmpeg/ffmpeg.js',
    coreBase: 'vendor/ffmpeg',
  },
  {
    ffmpegURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js',
    coreBase: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd',
  },
  {
    ffmpegURL: 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js',
    coreBase: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd',
  },
  {
    ffmpegURL: 'https://cdnjs.cloudflare.com/ajax/libs/ffmpeg/0.12.15/umd/ffmpeg.min.js',
    coreBase: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd',
  },
];
let ffmpegCoreBase = FFMPEG_LIB_SOURCES[0].coreBase;

const detectKind = (file) => {
  const t = file.type.toLowerCase();
  const ext = file.name.split('.').pop().toLowerCase();
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (t.startsWith('image/svg') || ext === 'svg') return 'svg';
  if (ext === 'ico') return 'ico';
  if (t.startsWith('video/') || VIDEO_EXTS.includes(ext)) return 'video';
  if (t.startsWith('audio/') || AUDIO_EXTS.includes(ext)) return 'audio';
  if (t.startsWith('image/')) return 'image';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext)) return 'image';
  return 'unknown';
};

const modeForKind = (kind) => (kind === 'video' || kind === 'audio' ? 'video' : 'image');
const isAudioTarget = (target) => AUDIO_TARGETS.includes(target);
const kindLabel = (kind) => ({
  image: 'Imagem',
  svg: 'SVG',
  ico: 'ICO',
  pdf: 'PDF',
  video: 'Vídeo',
  audio: 'Áudio',
}[kind] || 'Arquivo');

const stripExt = (name) => name.replace(/\.[^.]+$/, '');

const showToast = (msg, type = 'info') => {
  const wrap = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ico"></span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3900);
};

// ====== Tema ======
const themeBtn = $('#themeToggle');
const savedTheme = localStorage.getItem('neko-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'light' ? '' : 'light';
  if (cur) document.documentElement.dataset.theme = cur;
  else delete document.documentElement.dataset.theme;
  localStorage.setItem('neko-theme', cur);
});

// ====== Ano no footer ======
$('#year').textContent = new Date().getFullYear();

// ====== Drag & drop / file input ======
const dz = $('#dropzone');
const fi = $('#fileInput');
$('#browseBtn').addEventListener('click', (e) => { e.stopPropagation(); fi.click(); });
dz.addEventListener('click', () => fi.click());
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
fi.addEventListener('change', async (e) => {
  await addFiles(Array.from(e.target.files));
  fi.value = '';
});
$$('.mode-tab').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode, { fromUser: true }));
});

['dragenter', 'dragover'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-dragging'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-dragging'); })
);
dz.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files);
  if (files.length) addFiles(files);
});

// Permite colar imagens (Ctrl+V)
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  const files = [];
  for (const it of items) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) { addFiles(files); showToast('Arquivo colado', 'success'); }
});

// ====== Adicionar arquivos ======
async function addFiles(files) {
  for (const f of files) {
    const kind = detectKind(f);
    if (kind === 'unknown') {
      showToast(`Formato não suportado: ${f.name}`, 'error');
      continue;
    }
    const fileMode = modeForKind(kind);
    if (!state.files.length && state.mode !== fileMode) setMode(fileMode);
    if (state.files.length && state.mode !== fileMode) {
      showToast(`"${f.name}" pertence ao modo ${fileMode === 'video' ? 'vídeo/áudio' : 'imagens/PDF'}. Limpe a fila ou mude de modo.`, 'error');
      continue;
    }
    const item = {
      id: uid(),
      file: f,
      kind,
      name: f.name,
      size: f.size,
      ext: f.name.split('.').pop().toLowerCase(),
      thumb: null,
      progress: 0,
    };
    state.files.push(item);
    await generateThumb(item);
  }
  renderFiles();
  autoSelectTarget();
}

async function generateThumb(item) {
  if (item.kind === 'image' || item.kind === 'svg') {
    item.thumb = URL.createObjectURL(item.file);
  } else if (item.kind === 'pdf') {
    try {
      const buf = await item.file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 0.4 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      item.thumb = canvas.toDataURL('image/png');
    } catch (e) { console.warn('thumb pdf falhou', e); }
  } else if (item.kind === 'video') {
    try {
      item.thumb = await captureVideoThumb(item.file);
    } catch (e) { console.warn('thumb video falhou', e); }
  }
}

function captureVideoThumb(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (value, err) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      if (err) reject(err);
      else resolve(value);
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.min(0.6, Math.max(0, duration / 4));
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 180;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      finish(canvas.toDataURL('image/jpeg', 0.82));
    };
    video.onerror = () => finish(null, new Error('preview indisponível'));
    setTimeout(() => finish(null, new Error('preview demorou demais')), 2400);
    video.src = url;
  });
}

// ====== Render lista ======
function renderFiles() {
  const list = $('#fileList');
  const settings = $('#settings');
  if (!state.files.length) {
    list.innerHTML = '';
    list.hidden = true;
    settings.hidden = true;
    previewImageCache = null;
    previewRow.hidden = true;
    return;
  }
  list.hidden = false; settings.hidden = false;
  list.innerHTML = '';
  state.files.forEach((it) => {
    const el = document.createElement('div');
    el.className = 'file-item';
    el.dataset.id = it.id;
    el.innerHTML = `
      <div class="file-thumb">
        ${it.thumb
          ? `<img src="${it.thumb}" alt="" />`
          : `<span class="ext-tag">${it.ext}</span>`}
      </div>
      <div class="file-info">
        <div class="name" contenteditable="true" spellcheck="false">${stripExt(it.name)}</div>
        <div class="meta">${fmtBytes(it.size)} · ${kindLabel(it.kind)} · ${it.ext.toUpperCase()}</div>
      </div>
      <div class="file-progress"><i style="width:${it.progress}%"></i></div>
      <button type="button" class="file-remove" data-remove="${it.id}" title="Remover" aria-label="Remover arquivo">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;
    list.appendChild(el);
  });
  updateLivePreview();
}

// Event delegation para remover e renomear (sobrevive a re-renders)
$('#fileList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  e.stopPropagation();
  const id = btn.dataset.remove;
  state.files = state.files.filter((f) => f.id !== id);
  renderFiles();
});
$('#fileList').addEventListener('input', (e) => {
  const nameEl = e.target.closest('.name[contenteditable]');
  if (!nameEl) return;
  const item = nameEl.closest('.file-item');
  if (!item) return;
  const id = item.dataset.id;
  const f = state.files.find((x) => x.id === id);
  if (f) f.customName = nameEl.textContent.trim();
});
$('#fileList').addEventListener('keydown', (e) => {
  if (e.target.matches('.name[contenteditable]') && e.key === 'Enter') {
    e.preventDefault(); e.target.blur();
  }
});

// ====== Modos / formatos ======
const targetSel = $('#targetFormat');
const imageTargetOptions = targetSel.innerHTML;
const videoTargetOptions = `
  <optgroup label="Vídeo">
    <option value="mp4">MP4 — H.264 universal</option>
    <option value="mov">MOV — QuickTime</option>
    <option value="m4v">M4V — Apple</option>
    <option value="webm">WEBM — web moderno</option>
    <option value="mkv">MKV — contêiner flexível</option>
    <option value="avi">AVI — legado</option>
  </optgroup>
  <optgroup label="Extrair áudio">
    <option value="mp3">MP3 — universal</option>
    <option value="m4a">M4A — AAC</option>
    <option value="aac">AAC — compacto</option>
    <option value="wav">WAV — sem compressão</option>
    <option value="ogg">OGG — Vorbis</option>
  </optgroup>
`;
const formatSupport = {
  image: [
    ['PDF', '↔ imagens, multi-página'],
    ['PNG', 'com transparência'],
    ['JPG', 'qualidade ajustável'],
    ['WEBP', 'compressão moderna'],
    ['BMP', 'sem perdas'],
    ['GIF', 'quadro único'],
    ['ICO', 'favicon multi-tamanho'],
    ['SVG', '→ raster'],
  ],
  video: [
    ['MP4', 'H.264 universal'],
    ['MOV', 'QuickTime / Apple'],
    ['WEBM', 'VP9 para web'],
    ['MKV', 'contêiner flexível'],
    ['AVI', 'compatibilidade legada'],
    ['MP3', 'extração de áudio'],
    ['M4A', 'AAC compacto'],
    ['WAV', 'áudio sem compressão'],
  ],
};

targetSel.addEventListener('change', toggleSettings);
const videoQualityIn = $('#videoQuality');
const videoProcessSel = $('#videoProcess');

function syncVideoQualityLabel() {
  $('#videoQualityVal').textContent = videoQualityIn.value + ' CRF';
}

function resetVideoQualityToDefault() {
  videoQualityIn.value = videoQualityIn.defaultValue || '23';
  syncVideoQualityLabel();
}

videoQualityIn.addEventListener('input', syncVideoQualityLabel);
videoProcessSel.addEventListener('change', toggleSettings);
window.addEventListener('pageshow', (e) => {
  if (e.persisted) syncVideoQualityLabel();
  else resetVideoQualityToDefault();
});

function setMode(mode, opts = {}) {
  if (!['image', 'video'].includes(mode) || state.mode === mode) return;
  const hadQueue = state.files.length || state.results.length;
  state.mode = mode;
  document.body.dataset.mode = mode;
  fi.accept = mode === 'video' ? VIDEO_ACCEPT : IMAGE_ACCEPT;
  targetSel.innerHTML = mode === 'video' ? videoTargetOptions : imageTargetOptions;
  targetSel.value = mode === 'video' ? 'mp4' : 'png';

  $('#dropTitle').textContent = mode === 'video' ? 'Solte vídeos ou áudios aqui' : 'Solte arquivos aqui';
  $('#dropHint').textContent = mode === 'video'
    ? 'MP4 · MOV · WEBM · MKV · MP3 · WAV · conversão local com FFmpeg'
    : 'Imagens · PDF · SVG · ICO · até centenas de arquivos por vez';

  $$('.mode-tab').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (hadQueue) {
    state.files = [];
    state.results = [];
    renderFiles();
    renderResults();
  }

  renderFormatSupport();
  toggleSettings();
  updateLivePreview();

  if (opts.fromUser && hadQueue) showToast('Modo alterado. A fila foi limpa para evitar misturar tipos.', 'info');
  else if (opts.fromUser) showToast(`Modo ${mode === 'video' ? 'vídeo/áudio' : 'imagens/PDF'} ativo`, 'info');
}

function renderFormatSupport() {
  const rows = formatSupport[state.mode];
  $('#formatList').innerHTML = rows
    .map(([ext, desc]) => `<li><span class="ext">${ext}</span><span>${desc}</span></li>`)
    .join('');
  $('.side-title').textContent = state.mode === 'video' ? 'Formatos de vídeo' : 'Suporte de formatos';
  $('#sideTip').innerHTML = state.mode === 'video'
    ? '<strong>Dica:</strong> a primeira conversão carrega o motor FFmpeg no navegador; depois a fila fica mais rápida.'
    : '<strong>Dica:</strong> tudo roda no seu navegador. Funciona até offline depois que carrega.';
}

// ====== Auto-seleção do formato alvo ======
function autoSelectTarget() {
  if (!state.files.length) return;
  const kinds = new Set(state.files.map((f) => f.kind));
  const exts = new Set(state.files.map((f) => f.ext));

  if (state.mode === 'video') {
    if (kinds.size === 1 && kinds.has('audio')) targetSel.value = exts.size === 1 && exts.has('mp3') ? 'm4a' : 'mp3';
    else if (exts.size === 1 && exts.has('mp4')) targetSel.value = 'mov';
    else targetSel.value = 'mp4';
    toggleSettings();
    return;
  }

  // Se todos forem PDF, sugere PNG. Se já tem PNG, sugere JPEG.
  if (kinds.has('pdf') && kinds.size === 1) targetSel.value = 'png';
  else if (exts.has('png') && exts.size === 1) targetSel.value = 'jpeg';
  toggleSettings();
}

// ====== Toggle settings com base no alvo ======
function toggleSettings() {
  const target = targetSel.value;

  if (state.mode === 'video') {
    const audioOnly = isAudioTarget(target);
    const canRemux = !audioOnly && REMUX_TARGETS.includes(target);
    const copyOption = videoProcessSel.querySelector('option[value="copy"]');
    copyOption.disabled = !canRemux;
    if (!canRemux && videoProcessSel.value === 'copy') videoProcessSel.value = 'compatible';
    const remuxMode = canRemux && videoProcessSel.value === 'copy';

    $('#qualityWrap').style.display = 'none';
    $('#resizeWrap').style.display = 'none';
    $('#bgWrap').style.display = 'none';
    $('#pdfWrap').style.display = 'none';
    $('#imageAdvanced').hidden = true;
    $('#videoProcessWrap').hidden = audioOnly;
    $('#videoQualityWrap').hidden = audioOnly || remuxMode;
    $('#videoResizeWrap').hidden = audioOnly || remuxMode;
    $('#audioBitrateWrap').hidden = false;
    $('#mediaTuningRow').style.display = remuxMode ? 'none' : '';
    if (remuxMode) {
      $('#videoScale').value = '';
      $('#videoFps').value = '';
    }
    $('#videoFps').style.display = audioOnly ? 'none' : '';
    $('#stripAudioWrap').style.display = audioOnly ? 'none' : '';
    $('#fastStartWrap').style.display = !audioOnly && ['mp4', 'mov', 'm4v'].includes(target) ? '' : 'none';
    return;
  }

  $('#imageAdvanced').hidden = false;
  $('#videoProcessWrap').hidden = true;
  $('#videoQualityWrap').hidden = true;
  $('#videoResizeWrap').hidden = true;
  $('#audioBitrateWrap').hidden = true;
  $('#resizeWrap').style.display = '';
  $('#qualityWrap').style.display = ['jpg', 'jpeg', 'webp'].includes(target) ? '' : 'none';
  $('#bgWrap').style.display = ['jpg', 'jpeg', 'bmp', 'pdf'].includes(target) ? '' : 'none';
  $('#pdfWrap').style.display = target === 'pdf' ? '' : 'none';
  if (target === 'ico') {
    $('#resizePreset').value = '32x32';
    $('#resizeW').value = 32;
    $('#resizeH').value = 32;
  }
}

// ====== Quality slider ======
const qualityIn = $('#quality');
qualityIn.addEventListener('input', () => $('#qualityVal').textContent = qualityIn.value + '%');

// ====== Resize sync ======
const rW = $('#resizeW'), rH = $('#resizeH'), rPreset = $('#resizePreset'), keepRatio = $('#keepRatio');
rPreset.addEventListener('change', () => {
  const v = rPreset.value;
  if (!v) return;
  // formato "WxH" ou "N" (quadrado)
  const [w, h] = v.includes('x') ? v.split('x').map(Number) : [parseInt(v, 10), parseInt(v, 10)];
  rW.value = w; rH.value = h;
  // ao escolher predefinição, desliga manter proporção (tamanho exato)
  keepRatio.checked = false;
  updateLivePreview();
});
let lastRatio = 1;
async function captureRatio() {
  const f = state.files[0];
  if (!f || f.kind === 'pdf') return 1;
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth / img.naturalHeight);
    img.onerror = () => res(1);
    img.src = f.thumb || URL.createObjectURL(f.file);
  });
}
rW.addEventListener('input', async () => {
  if (!keepRatio.checked) return;
  if (!lastRatio || lastRatio === 1) lastRatio = await captureRatio();
  if (rW.value) rH.value = Math.round(rW.value / lastRatio);
});
rH.addEventListener('input', async () => {
  if (!keepRatio.checked) return;
  if (!lastRatio || lastRatio === 1) lastRatio = await captureRatio();
  if (rH.value) rW.value = Math.round(rH.value * lastRatio);
});

// ====== Rotação / Espelho ======
$('#rotateGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rot]');
  if (!b) return;
  $$('#rotateGroup .seg').forEach((s) => s.classList.remove('active'));
  b.classList.add('active');
  updateLivePreview();
});
$('#flipGroup').addEventListener('click', (e) => {
  const b = e.target.closest('[data-flip]');
  if (!b) return;
  b.classList.toggle('active');
  updateLivePreview();
});

// ====== Filtros ======
const filterDefs = [
  { id: 'fBright',   v: 'vBright',   def: 100, suffix: '%',  fn: 'brightness' },
  { id: 'fContrast', v: 'vContrast', def: 100, suffix: '%',  fn: 'contrast'   },
  { id: 'fSat',      v: 'vSat',      def: 100, suffix: '%',  fn: 'saturate'   },
  { id: 'fBlur',     v: 'vBlur',     def: 0,   suffix: 'px', fn: 'blur'       },
  { id: 'fGray',     v: 'vGray',     def: 0,   suffix: '%',  fn: 'grayscale'  },
  { id: 'fSepia',    v: 'vSepia',    def: 0,   suffix: '%',  fn: 'sepia'      },
  { id: 'fHue',      v: 'vHue',      def: 0,   suffix: '°',  fn: 'hue-rotate' },
  { id: 'fInvert',   v: 'vInvert',   def: 0,   suffix: '%',  fn: 'invert'     },
];
filterDefs.forEach((f) => {
  const input = $('#' + f.id);
  const out = $('#' + f.v);
  input.addEventListener('input', () => {
    out.textContent = input.value + f.suffix;
    // Limpa preset ativo ao mexer manualmente
    $$('#filterPresets button.active').forEach((b) => b.classList.remove('active'));
    updateLivePreview();
  });
});

function buildFilterCSS() {
  const parts = [];
  for (const f of filterDefs) {
    const val = parseFloat($('#' + f.id).value);
    if (val === f.def) continue;
    const arg = f.fn === 'hue-rotate' ? `${val}deg` : (f.suffix === 'px' ? `${val}px` : `${val}%`);
    parts.push(`${f.fn}(${arg})`);
  }
  return parts.join(' ');
}

function setFilters(values) {
  filterDefs.forEach((f) => {
    const v = values[f.id] ?? f.def;
    $('#' + f.id).value = v;
    $('#' + f.v).textContent = v + f.suffix;
  });
  updateLivePreview();
}

// Filtros preset
const filterPresets = {
  reset:   { fBright: 100, fContrast: 100, fSat: 100, fBlur: 0, fGray: 0, fSepia: 0, fHue: 0, fInvert: 0 },
  vintage: { fBright: 110, fContrast:  95, fSat:  85, fBlur: 0, fGray: 0, fSepia: 35, fHue: 0, fInvert: 0 },
  bw:      { fBright: 100, fContrast: 110, fSat:   0, fBlur: 0, fGray:100, fSepia: 0, fHue: 0, fInvert: 0 },
  vibrant: { fBright: 105, fContrast: 115, fSat: 145, fBlur: 0, fGray: 0, fSepia: 0, fHue: 0, fInvert: 0 },
  cool:    { fBright: 100, fContrast: 105, fSat: 110, fBlur: 0, fGray: 0, fSepia: 0, fHue:200, fInvert: 0 },
  warm:    { fBright: 105, fContrast: 100, fSat: 115, fBlur: 0, fGray: 0, fSepia: 25, fHue:340, fInvert: 0 },
  dream:   { fBright: 110, fContrast:  90, fSat: 110, fBlur: 1, fGray: 0, fSepia: 10, fHue: 0, fInvert: 0 },
  noir:    { fBright:  95, fContrast: 130, fSat:   0, fBlur: 0, fGray:100, fSepia: 0, fHue: 0, fInvert: 0 },
};
$('#filterPresets').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-preset]');
  if (!b) return;
  $$('#filterPresets button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  setFilters(filterPresets[b.dataset.preset] || filterPresets.reset);
});

// ====== Pré-visualização ao vivo ======
const previewCanvas = $('#previewCanvas');
const previewRow = $('#previewRow');
let previewImageCache = null;

async function updateLivePreview() {
  const file = state.files.find((f) => f.kind === 'image' || f.kind === 'svg');
  if (!file) {
    previewRow.hidden = true;
    previewImageCache = null;
    return;
  }
  // Carrega imagem (cache para performance)
  if (!previewImageCache || previewImageCache.id !== file.id) {
    try {
      const img = await loadImageElement(file);
      previewImageCache = { id: file.id, img };
    } catch { return; }
  }
  const img = previewImageCache.img;
  const opts = collectOptions();
  // Reduz para no máximo 360px de largura para preview
  const maxW = 360;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const swap = opts.rotate === 90 || opts.rotate === 270;
  const cw = swap ? h : w;
  const ch = swap ? w : h;

  previewCanvas.width = cw; previewCanvas.height = ch;
  const ctx = previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  ctx.save();
  if (opts.filterCSS) ctx.filter = opts.filterCSS;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((opts.rotate * Math.PI) / 180);
  ctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();

  previewRow.hidden = false;
}

// ====== Botões ======
$('#clearBtn').addEventListener('click', () => {
  state.files = []; state.results = [];
  renderFiles(); renderResults();
  showToast('Lista limpa', 'info');
});
$('#newBatchBtn').addEventListener('click', () => {
  state.files = []; state.results = [];
  renderFiles(); renderResults();
  $('#converter').scrollIntoView({ behavior: 'smooth' });
});
$('#convertBtn').addEventListener('click', convertAll);
$('#downloadAllBtn').addEventListener('click', downloadAllAsZip);

// Combos
$$('.combo').forEach((b) => {
  b.addEventListener('click', () => {
    const to = b.dataset.to;
    setMode(b.dataset.mode || 'image');
    targetSel.value = to;
    toggleSettings();
    $('#converter').scrollIntoView({ behavior: 'smooth' });
    showToast(`Pronto para converter para ${to.toUpperCase()}. Solte seus arquivos!`, 'info');
  });
});

// ====== Conversão principal ======
async function convertAll() {
  if (!state.files.length) { showToast('Adicione arquivos primeiro', 'error'); return; }
  const target = targetSel.value;
  const opts = collectOptions();
  state.results = [];
  $('#convertBtn').disabled = true;
  $('#convertBtn').classList.add('converting');

  try {
    if (state.mode === 'image' && target === 'pdf' && opts.pdfMerge && state.files.length > 1) {
      // Junta tudo num PDF só
      const blob = await mergeIntoPdf(state.files, opts);
      state.results.push({
        name: 'nekoconvert-merged.pdf',
        blob,
        originalSize: state.files.reduce((a, f) => a + f.size, 0),
        newSize: blob.size,
        mime: 'application/pdf',
      });
    } else {
      for (const item of state.files) {
        item.progress = 5;
        updateProgress(item);
        try {
          const out = await convertOne(item, target, opts);
          if (Array.isArray(out)) state.results.push(...out);
          else state.results.push(out);
          item.progress = 100;
        } catch (e) {
          console.error(e);
          showToast(`Erro em ${item.name}: ${e.message || e}`, 'error');
          item.progress = 0;
        }
        updateProgress(item);
      }
    }
    renderResults();
    showToast(`${state.results.length} arquivo(s) convertido(s) (=^.^=)`, 'success');
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    console.error(e);
    showToast('Falha na conversão: ' + (e.message || e), 'error');
  } finally {
    $('#convertBtn').disabled = false;
    $('#convertBtn').classList.remove('converting');
  }
}

function updateProgress(item) {
  const el = document.querySelector(`.file-item[data-id="${item.id}"] .file-progress > i`);
  if (el) el.style.width = item.progress + '%';
}

function collectOptions() {
  return {
    target: targetSel.value,
    quality: parseInt(qualityIn.value, 10) / 100,
    resizeW: parseInt(rW.value, 10) || null,
    resizeH: parseInt(rH.value, 10) || null,
    keepRatio: keepRatio.checked,
    bgColor: $('#bgColor').value,
    bgMode: $('#bgMode').value,
    pdfPageSize: $('#pdfPageSize').value,
    pdfOrientation: $('#pdfOrientation').value,
    pdfMerge: $('#pdfMerge').checked,
    rotate: parseInt(document.querySelector('#rotateGroup .seg.active')?.dataset.rot || '0', 10),
    flipH: !!document.querySelector('#flipGroup [data-flip="h"].active'),
    flipV: !!document.querySelector('#flipGroup [data-flip="v"].active'),
    filterCSS: buildFilterCSS(),
    videoQuality: parseInt($('#videoQuality').value, 10),
    videoProcess: videoProcessSel.value,
    videoScale: $('#videoScale').value,
    videoFps: $('#videoFps').value,
    audioBitrate: $('#audioBitrate').value,
    stripAudio: $('#stripAudio').checked,
    fastStart: $('#fastStart').checked,
  };
}

// Helper: aplica resize + rotação + flip + filtros num único canvas
function drawWithTransforms(srcImageOrCanvas, opts, naturalW, naturalH) {
  const sized = computeSize(naturalW, naturalH, opts);
  const swap = opts.rotate === 90 || opts.rotate === 270;
  const finalW = swap ? sized.height : sized.width;
  const finalH = swap ? sized.width : sized.height;

  const canvas = document.createElement('canvas');
  canvas.width = finalW; canvas.height = finalH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const needsBg = ['jpeg', 'jpg', 'bmp'].includes(opts.target);
  if (needsBg) {
    ctx.fillStyle = opts.bgMode === 'auto' ? '#fff'
      : opts.bgMode === 'white' ? '#fff'
      : opts.bgMode === 'black' ? '#000'
      : opts.bgColor;
    ctx.fillRect(0, 0, finalW, finalH);
  }

  ctx.save();
  if (opts.filterCSS) ctx.filter = opts.filterCSS;
  ctx.translate(finalW / 2, finalH / 2);
  if (opts.rotate) ctx.rotate((opts.rotate * Math.PI) / 180);
  ctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
  ctx.drawImage(srcImageOrCanvas, -sized.width / 2, -sized.height / 2, sized.width, sized.height);
  ctx.restore();

  return canvas;
}

// ====== Conversão por item ======
async function convertOne(item, target, opts) {
  if (item.kind === 'video' || item.kind === 'audio') {
    return await mediaToMedia(item, target, opts);
  }
  // PDF -> imagem
  if (item.kind === 'pdf' && target !== 'pdf') {
    return await pdfToImages(item, target, opts);
  }
  // imagem -> PDF
  if ((item.kind === 'image' || item.kind === 'svg' || item.kind === 'ico') && target === 'pdf') {
    return await imageToPdf(item, opts);
  }
  // imagem -> imagem (incluindo SVG -> raster)
  if ((item.kind === 'image' || item.kind === 'svg' || item.kind === 'ico') && target !== 'pdf') {
    return await imageToImage(item, target, opts);
  }
  // PDF -> PDF (recompactar com pdf-lib seria possível, por simplicidade só copia)
  if (item.kind === 'pdf' && target === 'pdf') {
    return {
      name: item.name,
      blob: item.file,
      originalSize: item.size,
      newSize: item.file.size,
      mime: 'application/pdf',
    };
  }
  throw new Error('combinação não suportada');
}

// ====== Video / audio -> video / audio ======
let ffmpegInstance = null;
let ffmpegReady = false;
let ffmpegLibsLoadingPromise = null;
let ffmpegLoadingPromise = null;
let ffmpegActiveItem = null;

function hasFFmpegLibraries() {
  return !!window.FFmpegWASM?.FFmpeg;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => reject(new Error(`falha ao baixar ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureFFmpegLibraries() {
  if (hasFFmpegLibraries()) return;
  if (ffmpegLibsLoadingPromise) return await ffmpegLibsLoadingPromise;

  ffmpegLibsLoadingPromise = (async () => {
    for (const source of FFMPEG_LIB_SOURCES) {
      try {
        if (!window.FFmpegWASM?.FFmpeg) await loadScript(source.ffmpegURL);
        if (hasFFmpegLibraries()) {
          ffmpegCoreBase = source.coreBase;
          return;
        }
      } catch (e) {
        console.warn('Falha ao carregar FFmpeg por CDN', source, e);
      }
    }

    throw new Error(
      'não consegui baixar o motor de vídeo. No celular, teste outra rede ou desative economia de dados, VPN/adblock e tente novamente.'
    );
  })();

  try {
    await ffmpegLibsLoadingPromise;
  } finally {
    ffmpegLibsLoadingPromise = null;
  }
}

async function fetchFileData(source) {
  if (typeof source === 'string' || source instanceof URL) {
    return new Uint8Array(await (await fetch(source)).arrayBuffer());
  }

  if (source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }

  return new Uint8Array();
}

async function toBlobURL(url, mimeType) {
  const data = await (await fetch(url)).arrayBuffer();
  return URL.createObjectURL(new Blob([data], { type: mimeType }));
}

async function ensureFFmpeg() {
  if (ffmpegReady && ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadingPromise) return await ffmpegLoadingPromise;

  await ensureFFmpegLibraries();

  const { FFmpeg } = window.FFmpegWASM;
  ffmpegInstance = new FFmpeg();
  ffmpegInstance.on('log', ({ message }) => console.debug('[ffmpeg]', message));
  ffmpegInstance.on('progress', ({ progress }) => {
    if (!ffmpegActiveItem || !Number.isFinite(progress)) return;
    ffmpegActiveItem.progress = Math.min(96, Math.max(8, Math.round(progress * 88) + 8));
    updateProgress(ffmpegActiveItem);
  });

  ffmpegLoadingPromise = (async () => {
    showToast('Carregando motor de vídeo (~31 MB)...', 'info');
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${ffmpegCoreBase}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${ffmpegCoreBase}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegReady = true;
    showToast('Motor de vídeo pronto', 'success');
    return ffmpegInstance;
  })();

  try {
    return await ffmpegLoadingPromise;
  } catch (e) {
    ffmpegInstance = null;
    ffmpegReady = false;
    throw e;
  } finally {
    ffmpegLoadingPromise = null;
  }
}

async function mediaToMedia(item, target, opts) {
  if (item.kind === 'audio' && !isAudioTarget(target)) {
    throw new Error('arquivos de áudio só podem sair como áudio');
  }
  if (!VIDEO_TARGETS.includes(target) && !isAudioTarget(target)) {
    throw new Error('formato de vídeo/áudio não suportado');
  }

  const ffmpeg = await ensureFFmpeg();
  const inputName = `input-${item.id}.${item.ext || 'bin'}`;
  const outputExt = mediaExtOf(target);
  const outputWorkName = `output-${item.id}.${outputExt}`;
  const args = buildMediaArgs(inputName, outputWorkName, target, opts, item);

  item.progress = Math.max(item.progress, 8);
  updateProgress(item);

  try {
    await ffmpeg.writeFile(inputName, await fetchFileData(item.file));
    ffmpegActiveItem = item;
    const code = await ffmpeg.exec(args);
    ffmpegActiveItem = null;
    if (code !== 0) {
      if (opts.videoProcess === 'copy') {
        throw new Error('modo rápido sem perda não é compatível com este arquivo. Troque Processamento para "compatível recomendado".');
      }
      throw new Error(`FFmpeg saiu com código ${code}`);
    }

    const data = await ffmpeg.readFile(outputWorkName);
    const blob = new Blob([data], { type: mediaMimeOf(target) });
    return {
      name: outputName(item, outputExt),
      blob,
      originalSize: item.size,
      newSize: blob.size,
      mime: mediaMimeOf(target),
    };
  } finally {
    ffmpegActiveItem = null;
    await deleteFFmpegFile(ffmpeg, inputName);
    await deleteFFmpegFile(ffmpeg, outputWorkName);
  }
}

function buildMediaArgs(inputName, outputName, target, opts, item) {
  const args = ['-y', '-i', inputName];

  if (isAudioTarget(target)) {
    args.push('-vn');
    if (target === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', opts.audioBitrate);
    else if (target === 'm4a' || target === 'aac') args.push('-c:a', 'aac', '-b:a', opts.audioBitrate);
    else if (target === 'wav') args.push('-c:a', 'pcm_s16le');
    else if (target === 'ogg') args.push('-c:a', 'libvorbis', '-b:a', opts.audioBitrate);
    args.push(outputName);
    return args;
  }

  if (item.kind !== 'video') throw new Error('saída de vídeo precisa de um arquivo de vídeo');

  args.push('-map', '0:v:0', '-map', '0:a?');

  const remuxMode = opts.videoProcess === 'copy' && REMUX_TARGETS.includes(target);
  if (remuxMode) {
    args.push('-sn', '-c:v', 'copy');
    if (opts.stripAudio) args.push('-an');
    else args.push('-c:a', 'copy');
    if (opts.fastStart && ['mp4', 'mov', 'm4v'].includes(target)) args.push('-movflags', '+faststart');
    args.push(outputName);
    return args;
  }

  const filters = [];
  if (opts.videoScale) filters.push(`scale=-2:${opts.videoScale}`);
  if (opts.videoFps) filters.push(`fps=${opts.videoFps}`);
  if (filters.length) args.push('-vf', filters.join(','));
  args.push('-sn');

  if (target === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(Math.min(42, opts.videoQuality + 8)), '-deadline', 'realtime', '-cpu-used', '4');
    if (opts.stripAudio) args.push('-an');
    else args.push('-c:a', 'libopus', '-b:a', opts.audioBitrate);
  } else if (target === 'avi') {
    args.push('-c:v', 'mpeg4', '-q:v', String(crfToQscale(opts.videoQuality)));
    if (opts.stripAudio) args.push('-an');
    else args.push('-c:a', 'libmp3lame', '-b:a', opts.audioBitrate);
  } else {
    const preset = opts.videoProcess === 'compress' ? 'veryfast' : 'ultrafast';
    args.push(
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(opts.videoQuality),
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709'
    );
    if (opts.stripAudio) args.push('-an');
    else args.push('-c:a', 'aac', '-b:a', opts.audioBitrate);
    if (opts.fastStart && ['mp4', 'mov', 'm4v'].includes(target)) args.push('-movflags', '+faststart');
  }

  args.push(outputName);
  return args;
}

function crfToQscale(crf) {
  return Math.max(2, Math.min(9, Math.round((crf - 14) / 3)));
}

async function deleteFFmpegFile(ffmpeg, name) {
  try { await ffmpeg.deleteFile(name); } catch {}
}

function mediaExtOf(target) {
  return target;
}

function mediaMimeOf(target) {
  if (target === 'mp4' || target === 'm4v') return 'video/mp4';
  if (target === 'mov') return 'video/quicktime';
  if (target === 'webm') return 'video/webm';
  if (target === 'mkv') return 'video/x-matroska';
  if (target === 'avi') return 'video/x-msvideo';
  if (target === 'mp3') return 'audio/mpeg';
  if (target === 'm4a') return 'audio/mp4';
  if (target === 'aac') return 'audio/aac';
  if (target === 'wav') return 'audio/wav';
  if (target === 'ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

// ====== Imagem -> Imagem ======
async function imageToImage(item, target, opts) {
  const img = await loadImageElement(item);
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;

  // ICO: gera múltiplos tamanhos (aplica filtros/rotação a cada tamanho)
  if (target === 'ico') {
    const sizes = [16, 32, 48];
    if (opts.resizeW && opts.resizeW !== opts.resizeH) sizes.push(opts.resizeW);
    if (opts.resizeW && !sizes.includes(opts.resizeW)) sizes.push(opts.resizeW);
    const transformed = drawWithTransforms(img, { ...opts, resizeW: 256, resizeH: 256, keepRatio: true }, natW, natH);
    const blob = await buildIco(transformed, sizes);
    return {
      name: outputName(item, 'ico'),
      blob,
      originalSize: item.size,
      newSize: blob.size,
      mime: 'image/x-icon',
    };
  }

  const canvas = drawWithTransforms(img, opts, natW, natH);
  const blob = await canvasToBlob(canvas, target, opts.quality);
  const mime = mimeOf(target);
  return {
    name: outputName(item, extOf(target)),
    blob,
    originalSize: item.size,
    newSize: blob.size,
    mime,
  };
}

function mimeOf(target) {
  if (target === 'jpg' || target === 'jpeg') return 'image/jpeg';
  if (target === 'webp') return 'image/webp';
  if (target === 'gif') return 'image/gif';
  if (target === 'bmp') return 'image/bmp';
  if (target === 'ico') return 'image/x-icon';
  if (target === 'pdf') return 'application/pdf';
  return 'image/png';
}
function extOf(target) {
  if (target === 'jpeg') return 'jpeg';
  if (target === 'jpg') return 'jpg';
  return target;
}
function outputName(item, ext) {
  const base = item.customName || stripExt(item.name);
  return base + '.' + ext;
}
async function canvasToBlob(canvas, target, quality) {
  if (target === 'bmp') return canvasToBmp(canvas);
  if (target === 'gif') return await canvasToGif(canvas);
  const mime = mimeOf(target);
  return await new Promise((res, rej) =>
    canvas.toBlob((b) => b ? res(b) : rej(new Error('toBlob falhou')), mime, quality)
  );
}

function loadImageElement(item) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('falha ao carregar imagem'));
    img.src = URL.createObjectURL(item.file);
  });
}

function computeSize(natW, natH, opts) {
  let w = natW, h = natH;
  if (opts.resizeW && opts.resizeH) {
    if (opts.keepRatio) {
      const ratio = natW / natH;
      // Ajusta para caber dentro
      if (opts.resizeW / opts.resizeH > ratio) {
        h = opts.resizeH; w = Math.round(h * ratio);
      } else {
        w = opts.resizeW; h = Math.round(w / ratio);
      }
    } else {
      w = opts.resizeW; h = opts.resizeH;
    }
  } else if (opts.resizeW) {
    const ratio = natW / natH; w = opts.resizeW; h = Math.round(w / ratio);
  } else if (opts.resizeH) {
    const ratio = natW / natH; h = opts.resizeH; w = Math.round(h * ratio);
  }
  return { width: w, height: h };
}

// ====== PDF -> imagens ======
async function pdfToImages(item, target, opts) {
  const buf = await item.file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  const total = pdf.numPages;
  for (let p = 1; p <= total; p++) {
    item.progress = Math.round((p - 1) / total * 90) + 5;
    updateProgress(item);

    const page = await pdf.getPage(p);
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = viewport.width; renderCanvas.height = viewport.height;
    const renderCtx = renderCanvas.getContext('2d');

    // Fundo branco para PDF (evita transparência preta)
    renderCtx.fillStyle = '#fff';
    renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

    await page.render({ canvasContext: renderCtx, viewport }).promise;

    // Aplica resize + rotação + flip + filtros
    const finalCanvas = drawWithTransforms(renderCanvas, opts, renderCanvas.width, renderCanvas.height);

    const base = item.customName || stripExt(item.name);
    const pageLabel = total > 1 ? `-page-${String(p).padStart(2, '0')}` : '';
    let blob;
    if (target === 'ico') {
      const img = await canvasToImage(finalCanvas);
      blob = await buildIco(img, [16, 32, 48]);
    } else {
      blob = await canvasToBlob(finalCanvas, target, opts.quality);
    }

    out.push({
      name: `${base}${pageLabel}.${extOf(target)}`,
      blob,
      originalSize: Math.round(item.size / total),
      newSize: blob.size,
      mime: mimeOf(target),
    });
  }
  return out;
}

function resizeCanvas(canvas, opts) {
  const { width, height } = computeSize(canvas.width, canvas.height, opts);
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, width, height);
  return out;
}

function canvasToImage(canvas) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = canvas.toDataURL('image/png');
  });
}

// ====== Imagem -> PDF ======
async function imageToPdf(item, opts) {
  const img = await loadImageElement(item);
  const { jsPDF } = window.jspdf;
  const c = drawWithTransforms(img, { ...opts, target: 'jpg' }, img.naturalWidth, img.naturalHeight);
  const w = c.width, h = c.height;
  const orient = opts.pdfOrientation === 'auto'
    ? (w >= h ? 'landscape' : 'portrait')
    : opts.pdfOrientation;

  let pdf;
  if (opts.pdfPageSize === 'auto') {
    pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
    pdf.addImage(c.toDataURL('image/jpeg', opts.quality || 0.92), 'JPEG', 0, 0, w, h);
  } else {
    pdf = new jsPDF({ orientation: orient, unit: 'mm', format: opts.pdfPageSize });
    placeImage(pdf, c, opts);
  }
  const blob = pdf.output('blob');
  return {
    name: outputName(item, 'pdf'),
    blob,
    originalSize: item.size,
    newSize: blob.size,
    mime: 'application/pdf',
  };
}

// ====== Mesclar várias imagens em 1 PDF ======
async function mergeIntoPdf(items, opts) {
  const { jsPDF } = window.jspdf;
  let pdf = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.progress = Math.round((i / items.length) * 90) + 5;
    updateProgress(item);

    if (item.kind === 'pdf') {
      // Renderiza páginas do PDF e adiciona cada uma
      const buf = await item.file.arrayBuffer();
      const srcPdf = await pdfjsLib.getDocument({ data: buf }).promise;
      for (let p = 1; p <= srcPdf.numPages; p++) {
        const page = await srcPdf.getPage(p);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        pdf = addCanvasPage(pdf, c, opts);
      }
      continue;
    }

    const img = await loadImageElement(item);
    const c = drawWithTransforms(img, { ...opts, target: 'jpg' }, img.naturalWidth, img.naturalHeight);
    pdf = addCanvasPage(pdf, c, opts);
  }

  for (const item of items) { item.progress = 100; updateProgress(item); }
  return pdf.output('blob');
}

let lastPdf = null;
function addCanvasPage(pdf, canvas, opts) {
  const { jsPDF } = window.jspdf;
  const w = canvas.width, h = canvas.height;
  if (!pdf) {
    if (opts.pdfPageSize === 'auto') {
      pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
      pdf.addImage(canvas.toDataURL('image/jpeg', opts.quality), 'JPEG', 0, 0, w, h);
    } else {
      const orient = opts.pdfOrientation === 'auto' ? (w >= h ? 'landscape' : 'portrait') : opts.pdfOrientation;
      pdf = new jsPDF({ orientation: orient, unit: 'mm', format: opts.pdfPageSize });
      placeImage(pdf, canvas, opts);
    }
  } else {
    if (opts.pdfPageSize === 'auto') {
      pdf.addPage([w, h], w >= h ? 'landscape' : 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', opts.quality), 'JPEG', 0, 0, w, h);
    } else {
      pdf.addPage();
      placeImage(pdf, canvas, opts);
    }
  }
  lastPdf = pdf;
  return pdf;
}
function placeImage(pdf, canvas, opts) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const ratio = canvas.width / canvas.height;
  let iw = pw - 20, ih = iw / ratio;
  if (ih > ph - 20) { ih = ph - 20; iw = ih * ratio; }
  const x = (pw - iw) / 2, y = (ph - ih) / 2;
  pdf.addImage(canvas.toDataURL('image/jpeg', opts.quality), 'JPEG', x, y, iw, ih);
}

// ====== Canvas -> BMP ======
function canvasToBmp(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;

  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelDataSize = rowSize * h;
  const fileSize = 54 + pixelDataSize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);

  // Header
  view.setUint8(0, 0x42); view.setUint8(1, 0x4D); // 'BM'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, 54, true);
  // DIB header
  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, -h, true); // top-down
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true); // 24 bpp
  view.setUint32(30, 0, true);
  view.setUint32(34, pixelDataSize, true);
  view.setUint32(38, 2835, true);
  view.setUint32(42, 2835, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  let p = 54;
  for (let y = 0; y < h; y++) {
    let rowStart = p;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // BGR
      view.setUint8(p++, data[i + 2]);
      view.setUint8(p++, data[i + 1]);
      view.setUint8(p++, data[i + 0]);
    }
    // padding 4 bytes
    while ((p - rowStart) % 4 !== 0) view.setUint8(p++, 0);
  }
  return new Blob([buf], { type: 'image/bmp' });
}

// ====== Canvas -> ICO (multi tamanhos PNG) ======
async function buildIco(srcImg, sizes) {
  const pngs = [];
  for (const s of sizes) {
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcImg, 0, 0, s, s);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const ab = await blob.arrayBuffer();
    pngs.push({ size: s, data: new Uint8Array(ab) });
  }
  // Header ICO
  const header = new Uint8Array(6);
  const dv = new DataView(header.buffer);
  dv.setUint16(0, 0, true);  // reserved
  dv.setUint16(2, 1, true);  // type = 1 (icon)
  dv.setUint16(4, pngs.length, true);

  const dirEntries = new Uint8Array(16 * pngs.length);
  let offset = 6 + dirEntries.length;
  pngs.forEach((p, idx) => {
    const o = idx * 16;
    dirEntries[o + 0] = p.size === 256 ? 0 : p.size;
    dirEntries[o + 1] = p.size === 256 ? 0 : p.size;
    dirEntries[o + 2] = 0; // colors
    dirEntries[o + 3] = 0; // reserved
    new DataView(dirEntries.buffer, dirEntries.byteOffset).setUint16(o + 4, 1, true);  // planes
    new DataView(dirEntries.buffer, dirEntries.byteOffset).setUint16(o + 6, 32, true); // bpp
    new DataView(dirEntries.buffer, dirEntries.byteOffset).setUint32(o + 8, p.data.length, true);
    new DataView(dirEntries.buffer, dirEntries.byteOffset).setUint32(o + 12, offset, true);
    offset += p.data.length;
  });

  const parts = [header, dirEntries, ...pngs.map((p) => p.data)];
  return new Blob(parts, { type: 'image/x-icon' });
}

// ====== Canvas -> GIF ======
async function canvasToGif(canvas) {
  // Tenta usar GIF.js (carregado via CDN). Se não disponível, exporta PNG como fallback.
  if (typeof GIF === 'undefined') {
    return await new Promise((r) => canvas.toBlob(r, 'image/png'));
  }
  return new Promise((resolve) => {
    try {
      const gif = new GIF({
        workers: 2, quality: 10, width: canvas.width, height: canvas.height,
        workerScript: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
      });
      gif.addFrame(canvas, { delay: 200 });
      gif.on('finished', (blob) => resolve(blob));
      gif.render();
    } catch {
      canvas.toBlob(resolve, 'image/png');
    }
  });
}

// ====== Render resultados ======
function renderResults() {
  const wrap = $('#results');
  const list = $('#resultList');
  const banner = $('#statsBanner');
  if (!state.results.length) { wrap.hidden = true; return; }
  wrap.hidden = false;

  // Stats banner
  const totalBefore = state.results.reduce((s, r) => s + (r.originalSize || 0), 0);
  const totalAfter = state.results.reduce((s, r) => s + r.newSize, 0);
  const diff = totalAfter - totalBefore;
  const pct = totalBefore ? (diff / totalBefore) * 100 : 0;
  const grew = diff > 0;
  banner.classList.toggle('grew', grew);
  banner.innerHTML = `
    <div class="stat">
      <span class="num">${state.results.length}</span>
      <span class="lbl">arquivo(s)</span>
    </div>
    <div class="stat">
      <span class="num">${fmtBytes(totalBefore)}</span>
      <span class="lbl">tamanho original</span>
    </div>
    <div class="stat">
      <span class="num">${fmtBytes(totalAfter)}</span>
      <span class="lbl">tamanho final</span>
    </div>
    <div class="stat">
      <span class="num ${grew ? 'warn' : 'green'}">${grew ? '+' : '−'}${fmtBytes(Math.abs(diff))}</span>
      <span class="lbl">${grew ? 'aumentou' : 'economizado'} (${pct.toFixed(1)}%)</span>
    </div>
  `;

  list.innerHTML = '';

  state.results.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    const url = URL.createObjectURL(r.blob);
    const ext = r.name.split('.').pop().toUpperCase();
    const isImage = r.mime.startsWith('image/') && r.mime !== 'image/x-icon';
    const isPdf = r.mime === 'application/pdf';
    const isVideo = r.mime.startsWith('video/');
    const isAudio = r.mime.startsWith('audio/');

    let preview;
    if (isImage) preview = `<img src="${url}" alt="" />`;
    else if (isVideo) preview = `<video src="${url}" controls preload="metadata"></video>`;
    else if (isAudio) preview = `<span class="placeholder">AUD</span>`;
    else if (isPdf) preview = `<span class="placeholder">PDF</span>`;
    else preview = `<span class="placeholder">${ext}</span>`;

    const diff = r.originalSize ? ((r.newSize - r.originalSize) / r.originalSize) * 100 : 0;
    const diffLabel = diff <= 0
      ? `<span class="saved">−${Math.abs(diff).toFixed(0)}%</span>`
      : `<span class="grew">+${diff.toFixed(0)}%</span>`;

    card.innerHTML = `
      <div class="result-thumb">${preview}</div>
      <div class="result-name" title="${r.name}">${r.name}</div>
      <div class="result-meta">
        <span>${fmtBytes(r.newSize)}</span>
        ${diffLabel}
      </div>
      <a class="result-download" href="${url}" download="${r.name}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v14M5 12l7 7 7-7M5 21h14"/></svg>
        Baixar
      </a>
    `;
    list.appendChild(card);
  });
}

// ====== Baixar tudo como ZIP ======
async function downloadAllAsZip() {
  if (!state.results.length) return;
  if (state.results.length === 1) {
    const r = state.results[0];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.blob);
    a.download = r.name; a.click();
    return;
  }
  const zip = new JSZip();
  state.results.forEach((r) => zip.file(r.name, r.blob));
  const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
    // poderia atualizar progresso aqui
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nekoconvert-${Date.now()}.zip`;
  a.click();
  showToast('ZIP gerado!', 'success');
}

// ====== Mascote: clica e ronrona ======
$('#mascot').addEventListener('click', () => {
  const phrases = [
    'Nyaa~ converto qualquer coisa! (=^･ω･^=)',
    'Solte arquivos aqui! ฅ^•ﻌ•^ฅ',
    'Sou rapidinho! (◕‿◕✿)',
    '100% no seu navegador~ (=^.^=)',
    'Neko Studios ama você ♥',
  ];
  showToast(phrases[Math.floor(Math.random() * phrases.length)], 'info');
});

// ====== Atalho: cmd/ctrl+enter para converter ======
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (state.files.length) { e.preventDefault(); convertAll(); }
  }
});

// Inicial
document.body.dataset.mode = state.mode;
renderFormatSupport();
resetVideoQualityToDefault();
toggleSettings();
updateLivePreview();
