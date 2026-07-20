const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: (url) => ipcRenderer.invoke('get-info', url),
  getPlaylist: (url) => ipcRenderer.invoke('get-playlist', url),
  download: (opts) => ipcRenderer.invoke('download', opts),
  cancel: () => ipcRenderer.invoke('cancel'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  chooseImage: () => ipcRenderer.invoke('choose-image'),
  openFolder: (folder) => ipcRenderer.invoke('open-folder', folder),
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  getWaveform: (opts) => ipcRenderer.invoke('waveform', opts),

  // Faz 8: yerel dosya kaynağı + kadraj yolu önizlemesi
  localInfo: (filePath) => ipcRenderer.invoke('local-info', filePath),
  chooseVideo: () => ipcRenderer.invoke('choose-video'),
  // Sürükle-bırakılan File nesnesinin gerçek disk yolunu güvenli şekilde verir
  // (Electron'da File.path kaldırıldı; webUtils.getPathForFile onun yerini alır)
  pathForFile: (file) => webUtils.getPathForFile(file),
  trackPreview: (opts) => ipcRenderer.invoke('track-preview', opts),
  cancelTrackPreview: () => ipcRenderer.invoke('track-preview-cancel'),
  cleanupTrackPreview: () => ipcRenderer.invoke('track-preview-cleanup'),
  onTrackPreviewProgress: (cb) => ipcRenderer.on('track-preview-progress', (e, p) => cb(p)),
  onProgress: (cb) => ipcRenderer.on('progress', (e, p) => cb(p)),
  onLog: (cb) => ipcRenderer.on('log', (e, line) => cb(line)),
  onPhase: (cb) => ipcRenderer.on('phase', (e, phase) => cb(phase)),
  onEta: (cb) => ipcRenderer.on('eta', (e, eta) => cb(eta)),

  platform: process.platform,
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  openReleasePage: () => ipcRenderer.invoke('open-release-page'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e, version) => cb(version)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (e, percent) => cb(percent)),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (e, message) => cb(message)),

  onMainError: (cb) => ipcRenderer.on('main-error', (e, message) => cb(message)),

  // v1.18.0: tarayıcı eklentisinden gelen trimtube:// bağlantısı
  // (main tarafında doğrulanmış {url, startSec})
  onDeepLink: (cb) => ipcRenderer.on('deep-link', (e, link) => cb(link)),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  cacheInfo: () => ipcRenderer.invoke('cache-info'),
  cacheClear: () => ipcRenderer.invoke('cache-clear'),

  // v1.17.0: yt-dlp (indirme motoru) sürüm bilgisi + elle güncelleme
  ytdlpInfo: () => ipcRenderer.invoke('ytdlp-info'),
  ytdlpUpdate: () => ipcRenderer.invoke('ytdlp-update'),

  // Faz 11: sıkıştırma (görsel kayıpsız yeniden kodlama ile boyut küçültme)
  compressVideo: (opts) => ipcRenderer.invoke('compress-video', opts),
  compressCancel: () => ipcRenderer.invoke('compress-cancel'),
  onCompressProgress: (cb) => ipcRenderer.on('compress-progress', (e, p) => cb(p)),

  // Faz 12: .trimtube proje dosyası + film şeridi
  projectSave: (data) => ipcRenderer.invoke('project-save', data),
  projectOpen: (path) => ipcRenderer.invoke('project-open', path),
  projectAskMode: () => ipcRenderer.invoke('project-ask-mode'),
  getFilmstrip: (opts) => ipcRenderer.invoke('filmstrip', opts),

  // Faz 13: Kurgu Motoru — Akıllı Kırpma (sessizlik + dolgu kelime tespiti/kırpma)
  smartTrimAnalyze: (opts) => ipcRenderer.invoke('smarttrim-analyze', opts),
  smartTrimApply: (opts) => ipcRenderer.invoke('smarttrim-apply', opts),
  smartTrimCancel: () => ipcRenderer.invoke('smarttrim-cancel'),
  onSmartTrimProgress: (cb) => ipcRenderer.on('smarttrim-progress', (e, p) => cb(p)),

  // Faz 14: AI Araçları (Gemini) — transkript + başlık/arama/hook/reklam kontrolü
  aiTestKey: (key) => ipcRenderer.invoke('ai-test-key', key),
  openGeminiKeyPage: () => ipcRenderer.invoke('open-gemini-key-page'),
  aiTranscript: (opts) => ipcRenderer.invoke('ai-transcript', opts),
  aiTitles: (opts) => ipcRenderer.invoke('ai-titles', opts),
  aiSearch: (opts) => ipcRenderer.invoke('ai-search', opts),
  aiHooks: (opts) => ipcRenderer.invoke('ai-hooks', opts),
  aiAdCheck: (opts) => ipcRenderer.invoke('ai-adcheck', opts),
  aiCancel: () => ipcRenderer.invoke('ai-cancel'),
  onAiProgress: (cb) => ipcRenderer.on('ai-progress', (e, p) => cb(p)),

  // Faz 15: Moodlar & AI Director (kurgu planı + TTS + montaj robotu)
  moodVoices: () => ipcRenderer.invoke('mood-voices'),
  moodPlan: (opts) => ipcRenderer.invoke('mood-plan', opts),
  moodRender: (opts) => ipcRenderer.invoke('mood-render', opts),
  moodCancel: () => ipcRenderer.invoke('mood-cancel'),
  onMoodProgress: (cb) => ipcRenderer.on('mood-progress', (e, p) => cb(p)),

  // Faz 16-B: B-Roll köprüsü (Pexels stok videoları)
  brollAnalyze: (opts) => ipcRenderer.invoke('broll-analyze', opts),
  brollRender: (opts) => ipcRenderer.invoke('broll-render', opts),
  brollCancel: () => ipcRenderer.invoke('broll-cancel'),
  onBrollProgress: (cb) => ipcRenderer.on('broll-progress', (e, p) => cb(p)),
  openPexelsKeyPage: () => ipcRenderer.invoke('open-pexels-key-page')
});
