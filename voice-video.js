// Anlatımlı video (ana süreç): metin/URL → Gemini senaryosu → sahne başına
// duygu etiketli TTS → isteğe bağlı Pexels medyası → HyperFrames ile sahne
// başına render → kayıpsız birleştirme + anlatım sesi. Her sahnenin sesi ve
// görüntüsü içerik özetiyle önbelleğe alınır; düzenlemeden sonra yalnız
// değişen sahneler yeniden üretilir. Diğer işlerden bağımsız kendi süreç ve
// iptal takibi vardır (Hikâye Kurgusu ile aynı desen).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const VoiceScript = require('./renderer/voice-script');
const Themes = require('./renderer/voice-themes');
const { buildScene, envelopeFromPcm, snap } = require('./voice-compose');
const MUSIC_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;
const { detectBeats, tileBeats } = require('./beat-detect');
const { createEma, wavBuffer } = require('./ema-tts');
// EMA Lightning sürümü (ONNX çevirisi): önbellek anahtarına girer, model değişirse sesler yenilenir
const EMA_ID = 'ema-lightning-1.0.4-onnx1';

const SAMPLE_RATE = 48000;
// Son sahnedeki 1 sn sessizlik: kurgu masası yerel dosya süresini tam saniyeye
// yuvarlar (aşağı); konuşma bu payla hiçbir zaman kırpılmaz ve son sahne
// diğer sahnelerin süresinden bağımsız kalır (yalnız değişen sahne render edilir).
const SCENE_GAP = 0.4, LAST_GAP = 1.0;
const ELEVEN_MODELS = ['eleven_v4', 'eleven_v3'];
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 20);
const PROJECT_ID = /^[a-z0-9-]{6,48}$/;
// Arka plan kaldırma modeli: ISNet genel amaçlı nesne ayırma (rembg dağıtımı,
// Apache-2.0). İlk kullanımda bir kez indirilir; boyut ve SHA-256 doğrulanır.
const CUTOUT_MODEL = {
  file: 'isnet-general-use.onnx', size: 178648008,
  sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
};

function register({ ipcMain, app, getWin, loadSettings, providerClient, ffmpeg, procEnv, uniquePath, sanitizeName, dialog = null, resolvePython = () => (process.platform === 'win32' ? 'python' : 'python3') }) {
  const root = () => path.join(app.getPath('userData'), 'voice-video');
  let busy = false, cancelled = false, scriptAbort = null, scriptCancelled = false;
  const procs = new Set(), aborts = new Set();
  const send = p => { try { getWin()?.webContents.send('vv-progress', p); } catch {} };
  const check = () => { if (cancelled) throw Object.assign(Error('İptal edildi.'), { cancelled: true }); };

  // ---- süreç yardımcıları ----
  function run(cmd, args, { env = procEnv, cwd, onLine = () => {} } = {}) {
    return new Promise(resolve => {
      if (cancelled) return resolve({ code: -1, stderr: 'İptal edildi.' });
      const proc = spawn(cmd, args, { windowsHide: true, env, cwd });
      procs.add(proc);
      let stderr = '', pending = '';
      const consume = d => { pending += d.toString('utf8'); const lines = pending.split(/\r?\n|\r/); pending = lines.pop(); lines.forEach(l => l.trim() && onLine(l)); };
      proc.stdout.on('data', consume);
      proc.stderr.on('data', d => { stderr = (stderr + d.toString('utf8')).slice(-20000); consume(d); });
      proc.on('error', err => { procs.delete(proc); resolve({ code: -1, stderr: err.message }); });
      proc.on('close', code => { procs.delete(proc); resolve({ code, stderr }); });
    });
  }
  function killAll() {
    for (const proc of procs) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
      else { try { proc.kill('SIGTERM'); } catch {} }
    }
    for (const ctrl of aborts) { try { ctrl.abort(); } catch {} }
  }
  async function timedFetch(url, options = {}, ms = 30000) {
    const ctrl = new AbortController(); aborts.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...options, signal: ctrl.signal }); }
    finally { clearTimeout(timer); aborts.delete(ctrl); }
  }
  async function readLimited(res, max) {
    const reader = res.body.getReader(), chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > max) { try { reader.cancel(); } catch {} throw Error('Dosya beklenenden büyük.'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  // ---- HyperFrames (video motoru) ----
  // Electron'un kendi Node'u (ELECTRON_RUN_AS_NODE) ile çalışır; kullanıcıda
  // ayrıca Node kurulu olması gerekmez. Ortam bilerek sıfırdan kurulur: API
  // anahtarları alt sürece geçmez, kullanım telemetrisi kapalıdır.
  function engine() {
    const bin = path.join(__dirname, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
    const gsap = path.join(__dirname, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
    let ffprobe = '';
    try { ffprobe = require('@ffprobe-installer/ffprobe').path; } catch {}
    return { bin, gsap, ffprobe, ok: fs.existsSync(bin) && fs.existsSync(gsap) && !!ffprobe && fs.existsSync(ffprobe) };
  }
  function engineEnv(ffprobe) {
    const keep = ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA', 'LANG', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'DISPLAY', 'WAYLAND_DISPLAY', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'COMSPEC'];
    const env = {};
    for (const k of keep) if (process.env[k]) env[k] = process.env[k];
    const system = process.platform === 'win32' ? [path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    env.PATH = [path.dirname(ffmpeg), path.dirname(ffprobe), ...system].join(path.delimiter);
    Object.assign(env, { ELECTRON_RUN_AS_NODE: '1', HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1', CI: '1', HYPERFRAMES_FFPROBE_PATH: ffprobe, NO_COLOR: '1' });
    return env;
  }
  let browserReady = false;
  async function ensureEngine() {
    const e = engine();
    if (!e.ok) throw Error('Video motoru bileşenleri eksik (HyperFrames/ffprobe). Uygulamayı yeniden kurun.');
    if (!browserReady) {
      send({ phase: 'engine', message: 'Video motoru hazırlanıyor… İlk kullanımda tarayıcı bileşeni indirilir (bir kerelik, birkaç dakika sürebilir).' });
      const r = await run(process.execPath, [e.bin, 'browser', 'ensure'], { env: engineEnv(e.ffprobe) });
      check();
      if (r.code !== 0) throw Error('Video motorunun tarayıcı bileşeni hazırlanamadı. İnternet bağlantısını kontrol edip tekrar deneyin.\n' + tail(r.stderr));
      browserReady = true;
    }
    return e;
  }
  const tail = s => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-4).join('\n');

  // ---- WAV yardımcıları (mono 16-bit 48 kHz) ----
  function wavHeader(bytes) {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
    h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(bytes, 40);
    return h;
  }
  function readPcm(file) {
    const buf = fs.readFileSync(file);
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4), size = buf.readUInt32LE(offset + 4);
      if (id === 'data') return buf.subarray(offset + 8, Math.min(buf.length, offset + 8 + size));
      offset += 8 + size + (size % 2);
    }
    throw Error('Ses dosyası çözümlenemedi.');
  }
  async function toWav(input, output, raw) {
    const args = ['-y', ...(raw ? ['-f', 's16le', '-ar', String(raw.rate), '-ac', '1'] : []), '-i', input, '-af', 'aresample=48000', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', output];
    const r = await run(ffmpeg, args); check();
    if (r.code !== 0 || !fs.existsSync(output)) throw Error('Seslendirme dosyası dönüştürülemedi.');
  }

  // ---- Seslendirme ----
  async function geminiTts(scene, voice, out, tmp) {
    const settings = loadSettings();
    const parsed = VoiceScript.parseNarration(scene.narration, 'gemini');
    const config = { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } } } };
    const result = await providerClient.generate({
      key: (settings.geminiKey || '').trim(), chain: settings.geminiTtsChain, kind: 'tts',
      setAbort: ctrl => { if (ctrl) aborts.add(ctrl); }, isCancelled: () => cancelled,
      body: model => VoiceScript.isLegacyGeminiTts(model)
        ? { contents: [{ parts: [{ text: VoiceScript.legacyGeminiText(parsed.segments) }] }], generationConfig: config }
        : { contents: [{ parts: VoiceScript.geminiParts(parsed.segments) }], generationConfig: config }
    });
    check();
    if (result.error) throw Error('Google seslendirmesi: ' + result.error);
    const mime = String(result.audio.mimeType || '').toLowerCase();
    const raw = /audio\/(l16|pcm)/.test(mime) ? { rate: +((mime.match(/rate=(\d+)/) || [])[1] || 24000) } : null;
    if (!raw && !/audio\/(wav|x-wav|wave|mpeg|mp3|ogg|flac)/.test(mime)) throw Error('Google seslendirmesi desteklenmeyen bir ses biçimi döndürdü.');
    const file = path.join(tmp, `g-${process.hrtime.bigint()}.${raw ? 'pcm' : 'bin'}`);
    fs.writeFileSync(file, Buffer.from(result.audio.data, 'base64'));
    try { await toWav(file, out, raw); } finally { fs.rmSync(file, { force: true }); }
    return result.model;
  }
  function elevenError(status, body) {
    if (status === 401) return 'ElevenLabs anahtarı geçersiz veya reddedildi. Ayarlar ekranından kontrol edin.';
    if (status === 403) return 'ElevenLabs anahtarının ses üretme izni yok.';
    if (status === 429) return 'ElevenLabs istek sınırına takıldı. Biraz bekleyip tekrar deneyin.';
    if (status === 402 || /quota_exceeded|insufficient.*credit/i.test(body)) return 'ElevenLabs karakter kotası doldu — hesabınızı kontrol edin.';
    if (status >= 500) return 'ElevenLabs hizmeti şu an yanıt veremiyor. Birkaç dakika sonra tekrar deneyin.';
    return `ElevenLabs isteği başarısız (${status}).`;
  }
  async function elevenTts(scene, voice, out, tmp) {
    const key = (loadSettings().elevenKey || '').trim();
    if (!key) throw Error('ElevenLabs anahtarı girilmemiş. Ayarlar → Bağlantılar bölümünden ekleyin.');
    if (!voice) throw Error('ElevenLabs sesi seçilmedi.');
    const text = VoiceScript.elevenText(VoiceScript.parseNarration(scene.narration, 'eleven').segments);
    for (const model of ELEVEN_MODELS) {
      let res;
      try {
        res = await timedFetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_192`, {
          method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: model })
        }, 120000);
      } catch (err) { check(); throw Error(err.name === 'AbortError' ? 'ElevenLabs isteği zaman aşımına uğradı.' : 'ElevenLabs bağlantısı kurulamadı.'); }
      check();
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Hesapta yeni model yoksa bir önceki duygu etiketli modele düş
        if ([400, 404, 422].includes(res.status) && /model/i.test(body) && model !== ELEVEN_MODELS.at(-1)) continue;
        throw Error(elevenError(res.status, body));
      }
      const file = path.join(tmp, `e-${process.hrtime.bigint()}.mp3`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      try { await toWav(file, out); } finally { fs.rmSync(file, { force: true }); }
      return model;
    }
    throw Error('ElevenLabs duygu etiketli modeli bu hesapta kullanılamıyor.');
  }

  // EMA Lightning: yerel, ücretsiz Türkçe TTS (ONNX, uygulamayla gelir). Duygu etiketi
  // okumaz; kelime zamanlarını kendisi verir, bu yüzden bu seslerde Whisper ölçümü gerekmez.
  const emaDir = () => app.isPackaged ? path.join(process.resourcesPath, 'ema') : path.join(__dirname, 'resources', 'ema');
  let ema = null;
  function emaEngine() {
    if (ema) return ema;
    if (!fs.existsSync(path.join(emaDir(), 'ema_text.onnx'))) throw Error('Yerel seslendirme modeli (EMA) bu kurulumda bulunamadı. Uygulamayı yeniden kurun.');
    ema = createEma({ dir: emaDir(), ort: require('onnxruntime-node') });
    return ema;
  }
  async function emaTts(scene, voice, out, wordsFile) {
    const speed = Math.min(1.3, Math.max(.8, +voice || 1));
    const text = VoiceScript.plainText(scene.narration);
    const seed = parseInt(hash(text).slice(0, 8), 16) % 2147483647; // aynı metin, aynı ses
    let r;
    try { r = await emaEngine().synthesize(text, { speed, seed }); }
    catch (err) { throw Error(/EMA/.test(err.message) ? err.message : 'Yerel seslendirme başarısız: ' + err.message); }
    check();
    if (!r.audio.length) throw Error('Yerel seslendirme boş ses üretti.');
    fs.writeFileSync(out, wavBuffer(r.audio, SAMPLE_RATE));
    fs.writeFileSync(wordsFile, JSON.stringify({ words: r.words }), 'utf8');
    return EMA_ID;
  }

  // ---- Pexels medyası ----
  async function pexelsMedia(scene, mode, landscape, dir, used, credits) {
    const key = (loadSettings().pexelsKey || '').trim();
    if (!key) throw Error('Pexels API anahtarı girilmemiş. Ayarlar → Bağlantılar bölümünden ekleyin veya stok medyayı kapatın.');
    const query = scene.keywords || scene.visual?.heading || '';
    if (!query) return null;
    const orientation = landscape ? 'landscape' : 'portrait';
    const cacheFile = path.join(dir, `pexels-${hash([mode, orientation, query])}.json`);
    let list;
    if (fs.existsSync(cacheFile)) { try { list = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {} }
    if (!list) {
      const url = mode === 'video'
        ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=8&size=medium`
        : `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=8`;
      let res;
      try { res = await timedFetch(url, { headers: { Authorization: key } }, 20000); }
      catch { check(); throw Error('Pexels bağlantısı kurulamadı.'); }
      check();
      if (res.status === 401 || res.status === 403) throw Error('Pexels anahtarı geçersiz. Ayarlar ekranından kontrol edin.');
      if (res.status === 429) throw Error('Pexels istek sınırına ulaşıldı. Bir süre sonra tekrar deneyin.');
      if (!res.ok) throw Error(`Pexels araması başarısız (${res.status}).`);
      const data = await res.json();
      const W = landscape ? 1920 : 1080, H = landscape ? 1080 : 1920;
      list = mode === 'video'
        ? (data.videos || []).map(v => {
          const files = (v.video_files || []).filter(f => /mp4/.test(f.file_type || '') && f.link && f.width);
          const pick = files.filter(f => Math.min(f.width, f.height) >= 720).sort((a, b) => Math.abs(a.width - W) - Math.abs(b.width - W))[0] || files.sort((a, b) => b.width - a.width)[0];
          return pick && { id: 'v' + v.id, kind: 'video', url: pick.link, by: v.user?.name || '', page: v.url, duration: v.duration };
        }).filter(Boolean)
        : (data.photos || []).map(p => p.src?.original && { id: 'p' + p.id, kind: 'image', url: `${p.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=${W}&h=${H}`, by: p.photographer || '', page: p.url }).filter(Boolean);
      fs.writeFileSync(cacheFile, JSON.stringify(list));
    }
    const pick = list.find(m => !used.has(m.id)) || list[0];
    if (!pick || !/^https:\/\/([a-z0-9-]+\.)*pexels\.com\//i.test(pick.url)) return null;
    used.add(pick.id);
    const file = path.join(dir, `${pick.id}.${pick.kind === 'video' ? 'mp4' : 'jpg'}`);
    if (!fs.existsSync(file)) {
      let res;
      try { res = await timedFetch(pick.url, {}, 120000); } catch { check(); throw Error('Stok medya indirilemedi.'); }
      check();
      if (!res.ok) throw Error(`Stok medya indirilemedi (${res.status}).`);
      const buf = await readLimited(res, 150 * 1024 * 1024);
      fs.writeFileSync(file + '.part', buf); fs.renameSync(file + '.part', file);
    }
    credits.set(pick.id, `${pick.kind === 'video' ? 'Video' : 'Fotoğraf'}: ${pick.by || 'Pexels'} — ${pick.page || 'https://www.pexels.com'}`);
    return { kind: pick.kind, file: path.basename(file), id: pick.id };
  }

  // ---- Kelime zamanları (Whisper, yerel) ----
  // Ölçüm ses dosyasının özetiyle önbelleklenir; senaryo metniyle hizalama her
  // üretimde yeniden yapılır. Python/faster-whisper yoksa hece ağırlıklı tahmin.
  async function wordTimings(scenes, audio, tmp, warnings) {
    const measured = audio.map(a => { try { return JSON.parse(fs.readFileSync(a.file.slice(0, -4) + '.words.json', 'utf8')).words; } catch { return null; } });
    const todo = audio.map((a, i) => i).filter(i => !measured[i]);
    if (todo.length) {
      send({ phase: 'align', pct: 0, message: 'Kelime zamanları ölçülüyor (Whisper)…' });
      const jobs = [];
      for (const i of todo) {
        const input = path.join(tmp, `align-${i}.wav`);
        const r = await run(ffmpeg, ['-y', '-i', audio[i].file, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', input]); check();
        if (r.code === 0) jobs.push({ input, out: audio[i].file.slice(0, -4) + '.words.json', prompt: VoiceScript.plainText(scenes[i].narration) });
      }
      const listFile = path.join(tmp, 'align-jobs.json');
      fs.writeFileSync(listFile, JSON.stringify(jobs), 'utf8');
      const modelDir = path.join(app.getPath('userData'), 'whisper-models');
      const model = fs.existsSync(path.join(modelDir, 'models--Systran--faster-whisper-small')) ? 'small' : 'base';
      let errLine = '';
      const r = await run(resolvePython(), [path.join(__dirname, 'voice_align.py'), listFile, '--model', model, '--model-dir', modelDir, '--lang', 'tr'], {
        onLine: line => { const m = line.match(/^PROGRESS (\d+)/); if (m) send({ phase: 'align', pct: +m[1], message: 'Kelime zamanları ölçülüyor (Whisper)…' }); if (line.startsWith('ERROR ')) errLine = line.slice(6); if (line.startsWith('STATUS model')) send({ phase: 'align', pct: 0, message: 'Ses tanıma modeli hazırlanıyor (ilk kullanımda indirilir)…' }); }
      });
      check();
      for (const i of todo) { try { measured[i] = JSON.parse(fs.readFileSync(audio[i].file.slice(0, -4) + '.words.json', 'utf8')).words; } catch {} }
      if (r.code !== 0 || todo.some(i => !measured[i])) warnings.push('Kelime zamanları tahmini kullanıldı' + (errLine ? `: ${errLine}` : /ENOENT/.test(r.stderr) ? ': Python bulunamadı.' : '.'));
    }
    return scenes.map((s, i) => VoiceScript.alignTimings(s.narration, measured[i], audio[i].speech));
  }

  // ---- Sahne medyası (sayfa görseli / kullanıcı dosyası) ----
  const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i, IMAGE_EXT = /\.(jpe?g|png|webp|avif|bmp)$/i;
  async function probeVisual(fileName) {
    const r = await run(ffmpeg, ['-hide_banner', '-i', fileName]);
    const line = (r.stderr.match(/Video:[^\n]*/) || [''])[0];
    const dims = line.match(/(\d{2,5})x(\d{2,5})/);
    const dur = r.stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    return { w: dims ? +dims[1] : 0, h: dims ? +dims[2] : 0, alpha: /\b(rgba|bgra|argb|abgr|ya8|ya16\w*|yuva\w*|rgba64\w*|pal8)\b/.test(line), duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0 };
  }
  // Görselin 24x24 RGBA özeti: gerçek şeffaflık oranı ve kenar renginin
  // tekdüzeliği (beyaz zeminli ürün çekimi kartı aynı renkle doldurulur).
  async function surfaceOf(fileName) {
    const buf = await new Promise(resolve => {
      const proc = spawn(ffmpeg, ['-i', fileName, '-frames:v', '1', '-vf', 'scale=24:24:flags=area,format=rgba', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
      const chunks = []; proc.stdout.on('data', d => chunks.push(d)); proc.on('error', () => resolve(null)); proc.on('close', code => resolve(code === 0 ? Buffer.concat(chunks) : null));
    });
    if (!buf || buf.length < 24 * 24 * 4) return { cutout: false, edge: null };
    let clear = 0; const edge = [];
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const o = (y * 24 + x) * 4;
      if (buf[o + 3] < 200) clear++;
      if (x === 0 || y === 0 || x === 23 || y === 23) edge.push([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]);
    }
    const opaque = edge.filter(p => p[3] > 200);
    const mean = [0, 1, 2].map(c => opaque.reduce((n, p) => n + p[c], 0) / Math.max(1, opaque.length));
    const spread = Math.sqrt(opaque.reduce((n, p) => n + [0, 1, 2].reduce((m, c) => m + (p[c] - mean[c]) ** 2, 0), 0) / Math.max(1, opaque.length * 3));
    const hex = '#' + mean.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    return { cutout: clear / 576 > .08, edge: opaque.length > 60 && spread < 14 ? hex : null };
  }
  async function thumbnail(fileName, video) {
    const r = await new Promise(resolve => {
      const proc = spawn(ffmpeg, [...(video ? ['-ss', '0.6'] : []), '-i', fileName, '-frames:v', '1', '-vf', 'scale=320:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { windowsHide: true });
      const chunks = []; proc.stdout.on('data', d => chunks.push(d)); proc.on('error', () => resolve(null)); proc.on('close', code => resolve(code === 0 ? Buffer.concat(chunks) : null));
    });
    return r && r.length < 90000 ? 'data:image/jpeg;base64,' + r.toString('base64') : '';
  }
  async function mediaInfo(p) {
    try {
      const full = path.resolve(String(p || ''));
      if (!(VIDEO_EXT.test(full) || IMAGE_EXT.test(full)) || !fs.statSync(full).isFile()) return { error: 'Desteklenen biçimler: JPG, PNG, WEBP, AVIF, BMP, MP4, MOV, M4V, WEBM.' };
      const video = VIDEO_EXT.test(full), info = await probeVisual(full);
      if (!info.w) return { error: 'Dosya okunamadı veya görüntü içermiyor.' };
      return { ok: true, media: { source: 'local', kind: video ? 'video' : 'image', path: full, thumb: await thumbnail(full, video) } };
    } catch { return { error: 'Dosya okunamadı.' }; }
  }
  ipcMain.handle('vv-choose-media', async () => {
    if (!dialog) return { cancelled: true };
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Görsel ve video', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'mp4', 'mov', 'm4v', 'webm'] }] });
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true };
    return mediaInfo(res.filePaths[0]);
  });
  ipcMain.handle('vv-media-info', (event, p) => mediaInfo(p));

  // Üretimde: sayfa görseli indirilir, yerel dosya kopyalanır; boyut ve şeffaflık
  // ölçülür (şeffaf PNG/WEBP ürün kesimi kartsız, gölgeli sunulur).
  async function sourceFile(media, dir, guard = check) {
    fs.mkdirSync(dir, { recursive: true });
    let target;
    if (media.source === 'page') {
      const ext = (media.url.split('?')[0].match(/\.(jpe?g|png|webp|avif|bmp)$/i) || [, 'img'])[1].toLowerCase();
      target = path.join(dir, `page-${hash(media.url)}.${ext}`);
      if (!fs.existsSync(target)) {
        let res;
        try { res = await timedFetch(media.url, { headers: { 'User-Agent': 'Mozilla/5.0 (TrimTube)', Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' } }, 45000); }
        catch { guard(); throw Error('Sayfa görseli indirilemedi.'); }
        guard();
        if (!res.ok) throw Error(`Sayfa görseli indirilemedi (HTTP ${res.status}).`);
        if (!/^image\/(jpeg|png|webp|avif|bmp)/i.test(res.headers.get('content-type') || '')) throw Error('Sayfa görseli desteklenen bir resim biçiminde değil.');
        const buf = await readLimited(res, 30 * 1024 * 1024);
        fs.writeFileSync(target + '.part', buf); fs.renameSync(target + '.part', target);
      }
    } else {
      if (!fs.existsSync(media.path)) throw Error(`Dosya bulunamadı (${path.basename(media.path)}) — taşınmış veya silinmiş olabilir.`);
      const st = fs.statSync(media.path);
      target = path.join(dir, `local-${hash([path.resolve(media.path), st.size, st.mtimeMs])}${path.extname(media.path).toLowerCase()}`);
      if (!fs.existsSync(target)) { fs.copyFileSync(media.path, target + '.part'); fs.renameSync(target + '.part', target); }
    }
    return target;
  }

  // ---- Arka plan kaldırma (yerel model, Python + onnxruntime) ----
  const modelFile = () => path.join(app.getPath('userData'), 'models', CUTOUT_MODEL.file);
  let modelReady = null;
  function ensureCutoutModel(progress) {
    const dest = modelFile();
    if (fs.existsSync(dest) && fs.statSync(dest).size === CUTOUT_MODEL.size) return Promise.resolve(dest);
    if (modelReady) return modelReady;
    modelReady = (async () => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let res;
      try { res = await timedFetch(CUTOUT_MODEL.url, { headers: { 'User-Agent': 'TrimTube' } }, 20 * 60 * 1000); }
      catch { throw Error('Arka plan kaldırma modeli indirilemedi (bağlantıyı kontrol edin).'); }
      if (!res.ok) throw Error(`Arka plan kaldırma modeli indirilemedi (HTTP ${res.status}).`);
      const part = dest + '.part', out = fs.createWriteStream(part), sha = crypto.createHash('sha256'), reader = res.body.getReader();
      let size = 0, last = -1;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > CUTOUT_MODEL.size) throw Error('Model dosyası beklenenden büyük.');
          sha.update(value);
          if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
          const pct = Math.floor(size / CUTOUT_MODEL.size * 100); if (pct !== last) { last = pct; progress?.(pct); }
        }
      } finally { await new Promise(r => out.end(r)); }
      if (size !== CUTOUT_MODEL.size || sha.digest('hex') !== CUTOUT_MODEL.sha256) { try { fs.unlinkSync(part); } catch {} throw Error('İndirilen model doğrulanamadı; yeniden deneyin.'); }
      fs.renameSync(part, dest);
      return dest;
    })().finally(() => { modelReady = null; });
    return modelReady;
  }
  // Kesim önbelleği: kaynak dosyanın içerik özeti → şeffaf PNG (konuya kırpılmış)
  const cutDir = () => path.join(root(), 'cutouts');
  async function cutoutOf(src, progress) {
    const key = hash([CUTOUT_MODEL.sha256, crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')]);
    const out = path.join(cutDir(), `cut-${key}.png`);
    if (fs.existsSync(out)) return out;
    const info = await probeVisual(src);
    if (!info.w) throw Error('Görsel okunamadı.');
    const model = await ensureCutoutModel(progress);
    fs.mkdirSync(cutDir(), { recursive: true });
    let errLine = '';
    const r = await new Promise(resolve => {
      const proc = spawn(resolvePython(), [path.join(__dirname, 'voice_cutout.py'), '--ffmpeg', ffmpeg, '--model', model, '--width', String(info.w), '--height', String(info.h), src, out + '.part.png'], { windowsHide: true, env: { ...procEnv, PYTHONIOENCODING: 'utf-8' } });
      procs.add(proc);
      let buf = '';
      const onData = d => { buf += d.toString('utf8'); const lines = buf.split(/\r?\n/); buf = lines.pop(); for (const l of lines) if (l.startsWith('ERROR ')) errLine = l.slice(6); };
      proc.stdout.on('data', onData); proc.stderr.on('data', onData);
      proc.on('error', err => { procs.delete(proc); resolve({ code: -1, missing: err.code === 'ENOENT' }); });
      proc.on('close', code => { procs.delete(proc); resolve({ code }); });
    });
    if (r.code !== 0 || !fs.existsSync(out + '.part.png')) {
      try { fs.unlinkSync(out + '.part.png'); } catch {}
      throw Error(errLine || (r.missing ? 'Arka plan kaldırma için Python bulunamadı (Whisper ile aynı kurulum gerekir).' : 'Arka plan kaldırılamadı.'));
    }
    fs.renameSync(out + '.part.png', out);
    return out;
  }
  async function alphaThumb(file) {
    const buf = await new Promise(resolve => {
      const proc = spawn(ffmpeg, ['-i', file, '-frames:v', '1', '-vf', 'scale=280:-2', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { windowsHide: true });
      const chunks = []; proc.stdout.on('data', d => chunks.push(d)); proc.on('error', () => resolve(null)); proc.on('close', code => resolve(code === 0 ? Buffer.concat(chunks) : null));
    });
    return buf && buf.length < 110000 ? 'data:image/png;base64,' + buf.toString('base64') : '';
  }
  // Önizleme: kullanıcı "Arka planı kaldır"ı açınca hemen çalışır; üretim aynı önbelleği kullanır
  ipcMain.handle('vv-cutout', async (event, m) => {
    const media = VoiceScript.normalizeMedia(m);
    if (!media || media.kind !== 'image') return { error: 'Arka plan yalnız görsellerden kaldırılabilir.' };
    try {
      const src = await sourceFile(media, path.join(cutDir(), 'src'), () => {});
      const out = await cutoutOf(src, pct => { try { event.sender.send('vv-cutout-progress', pct); } catch {} });
      return { ok: true, thumb: await alphaThumb(out) };
    } catch (err) { return { error: err.message || 'Arka plan kaldırılamadı.' }; }
  });

  async function prepareHero(media, dir, warnings, label) {
    let target = await sourceFile(media, dir);
    if (media.cutout && media.kind === 'image' && !VIDEO_EXT.test(target)) {
      try {
        send({ phase: 'media', message: `${label}: arka plan kaldırılıyor…` });
        const cut = await cutoutOf(target, pct => send({ phase: 'media', message: `Arka plan kaldırma modeli indiriliyor (bir kerelik, ~180 MB): %${pct}` }));
        check();
        const local = path.join(dir, path.basename(cut));
        if (!fs.existsSync(local)) fs.copyFileSync(cut, local);
        target = local;
      } catch (err) { if (err.cancelled) throw err; warnings.push(`${label}: ${err.message} Görsel özgün haliyle kullanıldı.`); }
    }
    const info = await probeVisual(target);
    if (!info.w || Math.min(info.w, info.h) < 200) throw Error('Görsel çok küçük veya okunamadı.');
    const video = VIDEO_EXT.test(target), surface = video ? { cutout: false, edge: null } : await surfaceOf(target);
    return { kind: video ? 'video' : 'image', file: 'media/' + path.basename(target), cutout: surface.cutout, edge: surface.cutout ? null : surface.edge, w: info.w, h: info.h };
  }

  const sfxCache = new Map();
  async function sfxPcm(kind) {
    if (sfxCache.has(kind)) return sfxCache.get(kind);
    const src = path.join(__dirname, 'assets', 'sfx', `${kind}.wav`);
    let clip = null;
    if (fs.existsSync(src)) clip = await new Promise(resolve => {
      const proc = spawn(ffmpeg, ['-i', src, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], { windowsHide: true });
      const chunks = []; proc.stdout.on('data', d => chunks.push(d)); proc.on('error', () => resolve(null)); proc.on('close', code => resolve(code === 0 ? Buffer.concat(chunks) : null));
    });
    sfxCache.set(kind, clip);
    return clip;
  }
  // Müziğin bir bölümünü 11 kHz mono çözüp ritmini bulur
  async function musicBeats(p, start = 0, seconds = 120) {
    const raw = await new Promise(resolve => {
      const proc = spawn(ffmpeg, ['-ss', String(Math.max(0, start)), '-t', String(seconds), '-i', p, '-vn', '-ac', '1', '-ar', '11025', '-f', 's16le', 'pipe:1'], { windowsHide: true });
      const chunks = []; proc.stdout.on('data', d => chunks.push(d)); proc.on('error', () => resolve(null)); proc.on('close', code => resolve(code === 0 ? Buffer.concat(chunks) : null));
    });
    return raw ? detectBeats(raw, 11025) : null;
  }
  ipcMain.handle('vv-choose-music', async () => {
    if (!dialog) return { cancelled: true };
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Müzik', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'] }] });
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true };
    const p = res.filePaths[0];
    const r = await run(ffmpeg, ['-hide_banner', '-i', p]);
    const dur = r.stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (!/Audio:/.test(r.stderr) || !dur) return { error: 'Dosyada ses bulunamadı.' };
    const beat = await musicBeats(p, 0, 90);
    return { ok: true, music: { path: p, name: path.basename(p), duration: +dur[1] * 3600 + +dur[2] * 60 + +dur[3], bpm: beat && beat.confidence >= .25 ? beat.bpm : null } };
  });

  // ---- Görsel temalar: hazır temalar + kullanıcı temaları (userData/voice-themes) ----
  const themeRoot = () => path.join(app.getPath('userData'), 'voice-themes');
  const themeFile = () => path.join(themeRoot(), 'themes.json');
  const logoDir = () => path.join(themeRoot(), 'logos');
  function readThemes() {
    try { const list = JSON.parse(fs.readFileSync(themeFile(), 'utf8')); return Array.isArray(list) ? list.slice(0, 40).map(t => Themes.normalizeTheme(t)) : []; }
    catch { return []; }
  }
  function writeThemes(list) {
    fs.mkdirSync(themeRoot(), { recursive: true });
    const tmpFile = themeFile() + '.part';
    fs.writeFileSync(tmpFile, JSON.stringify(list, null, 2), 'utf8'); fs.renameSync(tmpFile, themeFile());
  }
  function resolveTheme(id) {
    const custom = readThemes().find(t => t.id === id);
    return custom || Themes.BUILT_IN.find(t => t.id === id) || Themes.BUILT_IN[0];
  }
  async function logoThumb(file) { return fs.existsSync(file) ? thumbnail(file, false) : ''; }
  ipcMain.handle('vv-themes', async () => {
    const custom = readThemes();
    for (const t of custom) if (t.logo) t.logo.thumb = await logoThumb(path.join(logoDir(), t.logo.file));
    return { builtIn: Themes.BUILT_IN, custom };
  });
  ipcMain.handle('vv-theme-save', (event, theme) => {
    try {
      const t = Themes.normalizeTheme(theme);
      if (Themes.BUILT_IN.some(b => b.id === t.id)) t.id = 'custom-' + crypto.randomBytes(4).toString('hex');
      if (t.logo && !fs.existsSync(path.join(logoDir(), t.logo.file))) t.logo = null;
      const list = readThemes().filter(x => x.id !== t.id);
      if (list.length >= 40) return { error: 'En fazla 40 özel tema kaydedilebilir.' };
      list.push(t); writeThemes(list);
      return { ok: true, theme: t };
    } catch { return { error: 'Tema kaydedilemedi.' }; }
  });
  ipcMain.handle('vv-theme-delete', (event, id) => {
    try { writeThemes(readThemes().filter(t => t.id !== id)); return { ok: true }; } catch { return { error: 'Tema silinemedi.' }; }
  });
  // Dışa/içe aktarma: tek dosya (.trimtube-theme, JSON), logolar içine gömülü.
  // Uygulama yeniden kurulduğunda ya da başka bilgisayara taşınırken temalar korunur.
  const LOGO_TYPES = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
  const logoType = buf => Object.keys(LOGO_TYPES).find(k => LOGO_TYPES[k].every((b, i) => buf[i] === b) && (k !== 'webp' || buf.slice(8, 12).toString('latin1') === 'WEBP'));
  function exportPayload(themes) {
    return {
      app: 'trimtube', kind: 'voice-themes', version: 1, exportedAt: new Date().toISOString(),
      themes: themes.map(t => {
        const out = { ...t }; delete out.builtIn;
        if (t.logo) {
          const src = path.join(logoDir(), t.logo.file);
          out.logo = fs.existsSync(src) ? { position: t.logo.position, size: t.logo.size, data: fs.readFileSync(src).toString('base64') } : null;
        }
        return out;
      })
    };
  }
  ipcMain.handle('vv-theme-export', async (event, ids) => {
    if (!dialog) return { cancelled: true };
    const all = readThemes(), list = Array.isArray(ids) && ids.length ? all.filter(t => ids.includes(t.id)) : all;
    if (!list.length) return { error: 'Dışa aktarılacak özel tema yok (hazır temalar uygulamayla gelir).' };
    const name = list.length === 1 ? sanitizeName(list[0].name).slice(0, 60) || 'tema' : `TrimTube temalari (${list.length})`;
    const res = await dialog.showSaveDialog(getWin(), { defaultPath: path.join(app.getPath('documents'), name + '.trimtube-theme'), filters: [{ name: 'TrimTube teması', extensions: ['trimtube-theme'] }] });
    if (res.canceled || !res.filePath) return { cancelled: true };
    try { fs.writeFileSync(res.filePath, JSON.stringify(exportPayload(list), null, 2), 'utf8'); return { ok: true, count: list.length, file: res.filePath }; }
    catch { return { error: 'Tema dosyası yazılamadı.' }; }
  });
  function importThemes(raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return { error: 'Dosya bir TrimTube tema dosyası değil.' }; }
    if (!data || data.app !== 'trimtube' || data.kind !== 'voice-themes' || !Array.isArray(data.themes)) return { error: 'Dosya bir TrimTube tema dosyası değil.' };
    const list = readThemes(), taken = new Set([...list.map(t => t.id), ...Themes.BUILT_IN.map(t => t.id)]);
    const added = [], skipped = [];
    for (const item of data.themes.slice(0, 40)) {
      if (list.length >= 40) { skipped.push(String(item?.name || 'tema')); continue; }
      const { logo, ...rest } = item || {};
      const t = Themes.normalizeTheme(rest);
      // Aynı tema zaten varsa (aynı kimlik ve içerik) atla; kimlik çakışırsa yeni kimlikle ekle
      const same = list.find(x => x.id === t.id);
      if (same && JSON.stringify({ ...same, logo: null }) === JSON.stringify({ ...t, logo: null })) { skipped.push(t.name); continue; }
      if (taken.has(t.id)) t.id = 'custom-' + crypto.randomBytes(4).toString('hex');
      t.logo = null;
      if (logo && typeof logo.data === 'string' && logo.data.length < 7 * 1024 * 1024) {
        const buf = Buffer.from(logo.data, 'base64'), ext = logoType(buf);
        if (ext) {
          fs.mkdirSync(logoDir(), { recursive: true });
          const file = `logo-${hash(buf.toString('base64'))}.${ext}`;
          if (!fs.existsSync(path.join(logoDir(), file))) fs.writeFileSync(path.join(logoDir(), file), buf);
          t.logo = Themes.normalizeTheme({ logo: { file, position: logo.position, size: logo.size } }).logo;
        }
      }
      taken.add(t.id); list.push(t); added.push(t);
    }
    if (added.length) writeThemes(list);
    return { ok: true, added: added.map(t => ({ id: t.id, name: t.name })), skipped };
  }
  ipcMain.handle('vv-theme-import', async () => {
    if (!dialog) return { cancelled: true };
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'TrimTube teması', extensions: ['trimtube-theme', 'json'] }] });
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true };
    try {
      if (fs.statSync(res.filePaths[0]).size > 30 * 1024 * 1024) return { error: 'Tema dosyası çok büyük.' };
      return importThemes(fs.readFileSync(res.filePaths[0], 'utf8'));
    } catch { return { error: 'Tema dosyası okunamadı.' }; }
  });
  ipcMain.handle('vv-theme-logo', async () => {
    if (!dialog) return { cancelled: true };
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Logo', extensions: ['png', 'webp', 'jpg', 'jpeg'] }] });
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true };
    const src = res.filePaths[0], info = await probeVisual(src);
    if (!info.w) return { error: 'Logo okunamadı.' };
    fs.mkdirSync(logoDir(), { recursive: true });
    const st = fs.statSync(src), name = `logo-${hash([src, st.size, st.mtimeMs])}${path.extname(src).toLowerCase()}`;
    fs.copyFileSync(src, path.join(logoDir(), name));
    return { ok: true, file: name, thumb: await logoThumb(path.join(logoDir(), name)) };
  });
  ipcMain.handle('vv-choose-image', async () => {
    if (!dialog) return { cancelled: true };
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'Görsel', extensions: ['png', 'webp', 'jpg', 'jpeg'] }] });
    if (res.canceled || !res.filePaths?.[0]) return { cancelled: true };
    return { ok: true, path: res.filePaths[0], name: path.basename(res.filePaths[0]), thumb: await thumbnail(res.filePaths[0], false) };
  });
  // Tasarım tarifinden (ve isteğe bağlı örnek görselden) tema: Gemini yalnız şemaya uyan JSON döndürür
  ipcMain.handle('vv-theme-from-prompt', async (event, opts) => {
    scriptCancelled = false;
    const description = String(opts?.prompt || '').trim();
    if (description.length < 20) return { error: 'Tasarım tarifi çok kısa.' };
    const settings = loadSettings();
    const parts = [{ text: Themes.buildThemePrompt(description, { hasReference: !!opts.reference }) }];
    if (opts.reference && typeof opts.reference === 'string' && fs.existsSync(opts.reference)) {
      const jpg = await new Promise(resolve => {
        const proc = spawn(ffmpeg, ['-i', opts.reference, '-frames:v', '1', '-vf', 'scale=768:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { windowsHide: true });
        const chunks = []; proc.stdout.on('data', d => chunks.push(d)); proc.on('error', () => resolve(null)); proc.on('close', code => resolve(code === 0 ? Buffer.concat(chunks) : null));
      });
      if (jpg) parts.push({ inlineData: { mimeType: 'image/jpeg', data: jpg.toString('base64') } });
    }
    const result = await providerClient.generate({
      key: (settings.geminiKey || '').trim(), chain: settings.geminiModelChain,
      setAbort: ctrl => { scriptAbort = ctrl; }, isCancelled: () => scriptCancelled,
      body: model => ({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', ...(model.startsWith('gemini-2.') ? { temperature: 0.4 } : {}) } })
    });
    if (result.cancelled || scriptCancelled) return { cancelled: true };
    if (result.error) return { error: result.error };
    return { ok: true, theme: Themes.pinBrandColors(Themes.normalizeTheme({ ...result.data, id: undefined }), description) };
  });

  // ---- render ----
  async function renderScene(e, renderDir, html, out, workers) {
    const name = path.basename(out, '.mp4') + '.html';
    fs.writeFileSync(path.join(renderDir, name), html, 'utf8');
    const r = await run(process.execPath, [e.bin, 'render', renderDir, '-c', name, '-o', out + '.part.mp4', '-w', String(workers), '--crf', '19', '--quiet'], { env: engineEnv(e.ffprobe), cwd: renderDir });
    check();
    if (r.code !== 0 || !fs.existsSync(out + '.part.mp4')) throw Object.assign(Error('Sahne render edilemedi: ' + tail(r.stderr)), { render: true });
    fs.renameSync(out + '.part.mp4', out);
  }
  async function pool(items, size, fn) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) { const i = next++; await fn(items[i], i); }
    }));
  }

  function pruneJobs(keep) {
    try {
      const limit = Date.now() - 14 * 86400000;
      for (const name of fs.readdirSync(root())) {
        const dir = path.join(root(), name);
        if (name !== keep && fs.statSync(dir).mtimeMs < limit) fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {}
  }

  // ---- IPC ----
  ipcMain.handle('vv-source', async (event, { url }) => {
    let parsed;
    try { parsed = new URL(String(url || '').trim()); } catch { return { error: 'Bağlantı geçersiz. http:// veya https:// ile başlayan tam adresi yapıştırın.' }; }
    if (!/^https?:$/.test(parsed.protocol)) return { error: 'Yalnızca http ve https bağlantıları okunabilir.' };
    scriptCancelled = false;
    const ctrl = new AbortController(); scriptAbort = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(parsed.href, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (TrimTube; +https://github.com/mehmetakarim/TrimTube)', Accept: 'text/html,text/plain;q=0.9' } });
      if (!res.ok) return { error: `Sayfa açılamadı (HTTP ${res.status}).` };
      const type = res.headers.get('content-type') || '';
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return { error: 'Bağlantı bir web sayfası değil (metin okunamaz).' };
      const body = (await readLimited(res, 5 * 1024 * 1024)).toString('utf8');
      const page = /text\/plain/i.test(type) ? { title: '', text: body.slice(0, 40000) } : VoiceScript.extractReadable(body);
      if (page.text.length < 300) return { error: 'Sayfadan yeterli okunabilir metin çıkarılamadı (içerik JavaScript ile yükleniyor olabilir). Metni kopyalayıp “Metin” sekmesine yapıştırın.' };
      const images = /text\/plain/i.test(type) ? [] : VoiceScript.extractImages(body, res.url || parsed.href);
      return { ok: true, title: page.title, text: page.text, url: res.url || parsed.href, images };
    } catch (err) {
      if (scriptCancelled) return { cancelled: true };
      return { error: err.name === 'AbortError' ? 'Sayfa zaman aşımına uğradı.' : 'Sayfa okunamadı: ' + (err.message || err) };
    } finally { clearTimeout(timer); if (scriptAbort === ctrl) scriptAbort = null; }
  });

  ipcMain.handle('vv-script', async (event, opts) => {
    scriptCancelled = false;
    const settings = loadSettings();
    const source = String(opts?.source || '').trim();
    if (source.length < 40) return { error: 'Kaynak metin çok kısa. En az birkaç cümle girin.' };
    const theme = resolveTheme(String(opts.themeId || ''));
    const images = (Array.isArray(opts.images) ? opts.images : []).filter(p => p && typeof p.url === 'string' && /^https?:\/\//i.test(p.url)).slice(0, 24).map(p => ({ url: p.url, alt: String(p.alt || '').slice(0, 120) }));
    const prompt = VoiceScript.buildScriptPrompt({ images,
      source, title: String(opts.title || ''), format: opts.format === 'podcast' ? 'podcast' : 'reels',
      length: opts.length, provider: ['eleven', 'ema'].includes(opts.provider) ? opts.provider : 'gemini', fromUrl: !!opts.fromUrl, theme, designNote: String(opts.designNote || '').slice(0, 600)
    });
    // Senaryo akışla alınır ve Gemini 3'te düşünce özetleri de akıtılır (includeThoughts; senaryoya
    // katılmaz). Aksi halde model düşünürken tek bayt göndermiyor; podcast'te bu 60 sn'yi aşıyor ve
    // bazı ağ cihazları boşta kalan bağlantıyı kesiyor (ECONNRESET). Ölçüm: ilk bayt ~2 sn, en uzun
    // ara <3 sn. Podcast'te düşünme "medium": aynı uzunluk, daha kısa süre (uzun: 82 sn vs 115 sn).
    const podcast = opts.format === 'podcast';
    const attemptMs = podcast ? { short: 120000, long: 240000 }[opts.length] || 180000 : 75000;
    const result = await providerClient.generate({
      key: (settings.geminiKey || '').trim(), chain: settings.geminiModelChain,
      setAbort: ctrl => { scriptAbort = ctrl; }, isCancelled: () => scriptCancelled, attemptMs, timeoutMs: attemptMs * 2 + 30000,
      stream: true, onText: (chars, thoughts) => send({ phase: 'script', chars, thoughts }),
      body: model => ({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json',
        ...(model.startsWith('gemini-2.') ? { temperature: 0.8 } : {}), ...(/^gemini-3/.test(model) ? { thinkingConfig: { includeThoughts: true, ...(podcast ? { thinkingLevel: 'medium' } : {}) } } : {}) } })
    });
    if (result.cancelled || scriptCancelled) return { cancelled: true };
    if (result.error) return { error: result.error };
    try { return { ok: true, script: VoiceScript.normalizeScript(result.data, { images }), model: result.model }; }
    catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('vv-cancel', () => {
    cancelled = true; scriptCancelled = true; killAll();
    if (scriptAbort) { try { scriptAbort.abort(); } catch {} }
  });

  ipcMain.handle('vv-produce', async (event, job) => {
    if (busy) return { error: 'Devam eden bir video üretimi var.' };
    if (!job || !PROJECT_ID.test(String(job.projectId || ''))) return { error: 'Proje kimliği geçersiz.' };
    const format = job.format === 'podcast' ? 'podcast' : 'reels', landscape = format === 'podcast';
    const provider = ['eleven', 'ema'].includes(job.provider) ? job.provider : 'gemini';
    const waveMode = format === 'podcast' && ['wave', 'audiogram'].includes(job.waveMode) ? job.waveMode : 'none';
    const mediaMode = ['image', 'video'].includes(job.mediaMode) && waveMode !== 'audiogram' ? job.mediaMode : 'off';
    let scenes;
    try { scenes = (Array.isArray(job.scenes) ? job.scenes : []).slice(0, 40).map(s => VoiceScript.normalizeScene(s)).filter(s => VoiceScript.plainText(s.narration)); }
    catch { return { error: 'Sahne listesi geçersiz.' }; }
    if (!scenes.length) return { error: 'Seslendirilecek sahne yok.' };
    const title = String(job.title || 'Anlatımlı video').slice(0, 120);
    busy = true; cancelled = false;
    const dir = path.join(root(), job.projectId), audioDir = path.join(dir, 'audio'), renderDir = path.join(dir, 'render'), mediaDir = path.join(renderDir, 'media'), segDir = path.join(dir, 'segments'), tmp = path.join(dir, 'tmp');
    const warnings = [];
    try {
      for (const d of [audioDir, renderDir, mediaDir, segDir, tmp]) fs.mkdirSync(d, { recursive: true });
      pruneJobs(job.projectId);
      fs.utimesSync(dir, new Date(), new Date());

      // 1) Seslendirme — sahne başına; metin+ses+sağlayıcı aynıysa önbellekten
      const settings = loadSettings();
      const audio = [];
      for (let i = 0; i < scenes.length; i++) {
        check();
        const s = scenes[i], key = hash([provider, job.voice || '', provider === 'gemini' ? settings.geminiTtsChain || '' : provider === 'ema' ? EMA_ID : ELEVEN_MODELS, provider === 'ema' ? VoiceScript.plainText(s.narration) : s.narration]);
        const file = path.join(audioDir, `${key}.wav`);
        if (!fs.existsSync(file)) {
          send({ phase: 'tts', pct: i / scenes.length * 100, message: `Seslendiriliyor: sahne ${i + 1}/${scenes.length}` });
          const part = file + '.part.wav';
          if (provider === 'ema') await emaTts(s, job.voice, part, file.slice(0, -4) + '.words.json');
          else if (provider === 'eleven') await elevenTts(s, job.voice, part, tmp); else await geminiTts(s, job.voice, part, tmp);
          fs.renameSync(part, file);
        }
        const pcm = readPcm(file);
        const speech = pcm.length / 2 / SAMPLE_RATE;
        if (speech < 0.3) throw Error(`Sahne ${i + 1} için ses üretilemedi (boş ses döndü).`);
        audio.push({ file, pcm, speech });
      }

      // 1b) Kelime zamanları: görseller konuşmayla senkron girsin diye
      const words = await wordTimings(scenes, audio, tmp, warnings);

      // 1c) Müzik: seçilen başlangıçtan döngü birimi; istenirse ritmi bulunur
      const music = job.music && typeof job.music.path === 'string' && MUSIC_EXT.test(job.music.path) && fs.existsSync(job.music.path) ? job.music.path : null;
      if (job.music && !music) warnings.push('Müzik dosyası bulunamadı; müziksiz üretildi.');
      let musicUnit = null, unitLength = 0, beat = null;
      if (music) {
        const start = Math.max(0, +job.music.start || 0);
        musicUnit = path.join(tmp, 'music-unit.wav');
        const r = await run(ffmpeg, ['-y', '-ss', String(start), '-i', music, '-vn', '-ac', '2', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', musicUnit]); check();
        unitLength = r.code === 0 && fs.existsSync(musicUnit) ? (fs.statSync(musicUnit).size - 44) / 4 / SAMPLE_RATE : 0;
        if (unitLength < 1) { warnings.push('Müzik okunamadı; müziksiz üretildi.'); musicUnit = null; }
        else if (job.music.beatSync !== false) {
          beat = await musicBeats(musicUnit, 0, Math.min(unitLength, 120));
          if (!beat || beat.confidence < .25) { beat = null; warnings.push('Müzikte belirgin bir ritim bulunamadı; geçişler ritme oturtulmadı.'); }
        }
      }
      const beats = beat ? tileBeats(beat, unitLength, audio.reduce((n, a) => n + a.speech + 2, 0) + 10) : [];

      // 2) Zamanlama: sahne süresi = ses + kısa nefes, kare hizalı; ritim varsa
      // sonraki sahne en yakın vuruşta başlar (konuşma asla kısalmaz)
      let t = 0;
      const timed = scenes.map((s, i) => {
        let duration = snap(audio[i].speech + (i === scenes.length - 1 ? LAST_GAP : SCENE_GAP));
        if (beats.length && i < scenes.length - 1) {
          const desired = t + audio[i].speech + SCENE_GAP;
          const next = beats.find(b => b >= desired - .04);
          if (next !== undefined && next - desired <= Math.max(.6, beat.period * 1.05)) duration = snap(Math.max(audio[i].speech + .15, next - t));
        }
        const item = { ...s, start: +t.toFixed(4), duration, speech: audio[i].speech, words: words[i], beats: beats.filter(b => b >= t - .01 && b < t + duration).map(b => +(b - t).toFixed(3)) }; t += duration; return item;
      });

      // 3a) Sahne görselleri (sayfadan veya kullanıcıdan) — sahnenin kahramanı
      const heroes = new Array(scenes.length).fill(null);
      for (let i = 0; i < scenes.length; i++) {
        if (!scenes[i].media || scenes[i].direction?.hero === 'none') continue;
        check();
        send({ phase: 'media', pct: i / scenes.length * 100, message: `Sahne görselleri hazırlanıyor: ${i + 1}/${scenes.length}` });
        try { heroes[i] = await prepareHero(scenes[i].media, mediaDir, warnings, `Sahne ${i + 1}`); }
        catch (err) { if (err.cancelled) throw err; warnings.push(`Sahne ${i + 1}: ${err.message} Görselsiz devam edildi.`); }
      }
      // 3b) Stok medya (isteğe bağlı) — bulunamazsa sahne şablon zeminiyle sürer
      const media = new Array(scenes.length).fill(null), credits = new Map();
      if (mediaMode !== 'off') {
        const used = new Set();
        for (let i = 0; i < scenes.length; i++) {
          check();
          if (heroes[i]) continue; // görselli sahne kendi zeminini kullanır
          send({ phase: 'media', pct: i / scenes.length * 100, message: `Stok ${mediaMode === 'video' ? 'video' : 'fotoğraf'} aranıyor: sahne ${i + 1}/${scenes.length}` });
          try { media[i] = await pexelsMedia(scenes[i], mediaMode, landscape, mediaDir, used, credits); }
          catch (err) { if (err.cancelled) throw err; if (/anahtar/.test(err.message)) throw err; warnings.push(`Sahne ${i + 1}: ${err.message}`); }
        }
      }

      // 3c) Görsel tema ve logo
      const theme = resolveTheme(String(job.themeId || ''));
      let logoFile = null;
      if (theme.logo) {
        const src = path.join(logoDir(), theme.logo.file);
        if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(mediaDir, theme.logo.file)); logoFile = 'media/' + theme.logo.file; }
        else warnings.push('Temanın logo dosyası bulunamadı; logosuz üretildi.');
      }

      // 4) Render — sahne başına kompozisyon; içerik özeti aynıysa önceki görüntü kullanılır
      const e = await ensureEngine();
      fs.copyFileSync(e.gsap, path.join(renderDir, 'gsap.min.js'));
      const plan = timed.map((s, i) => {
        const envelope = waveMode === 'none' ? null : envelopeFromPcm(Buffer.concat([audio[i].pcm, Buffer.alloc(Math.max(0, Math.round((s.duration - s.speech) * SAMPLE_RATE)) * 2)]), SAMPLE_RATE);
        const input = { scene: { visual: s.visual, direction: s.direction }, theme, logo: logoFile, index: i, total: timed.length, duration: s.duration, speech: s.speech, words: s.words, format, media: media[i] && { kind: media[i].kind, file: 'media/' + media[i].file }, hero: heroes[i], waveMode, envelope, title, captions: !!job.captions, safeArea: job.safeArea !== false, beats: s.beats, beatPeriod: beat ? beat.period : 0 };
        const { html, sfx, transition } = buildScene(input);
        return { i, html, sfx, transition, input, out: path.join(segDir, `seg-${hash(html)}.mp4`) };
      });
      const todo = plan.filter(p => !fs.existsSync(p.out));
      let done = plan.length - todo.length;
      send({ phase: 'render', pct: done / plan.length * 100, message: todo.length ? `Sahneler render ediliyor (${todo.length} sahne)…` : 'Sahneler önbellekten alındı.' });
      const parallel = Math.max(1, Math.min(3, Math.floor(require('os').cpus().length / 4)));
      await pool(todo, parallel, async p => {
        await renderScene(e, renderDir, p.html, p.out, 2);
        done++;
        send({ phase: 'render', pct: done / plan.length * 100, message: `Render: ${done}/${plan.length} sahne` });
      });
      check();

      // 5) Birleştirme: görüntü kayıpsız art arda, anlatım tek parça WAV
      send({ phase: 'assemble', pct: 100, message: 'Video birleştiriliyor…' });
      const narration = path.join(tmp, 'narration.wav');
      const blocks = timed.map((s, i) => {
        const bytes = Math.round(s.duration * SAMPLE_RATE) * 2;
        const pcm = audio[i].pcm.subarray(0, Math.min(audio[i].pcm.length, bytes));
        return Buffer.concat([pcm, Buffer.alloc(bytes - pcm.length)]);
      });
      const pcm = Buffer.concat(blocks);
      // Ses efektleri: sahne geçişinde whoosh (görüntüdeki whip ile), vurgu anlarında pop
      if (job.sfx !== false) {
        const events = [];
        timed.forEach((s, i) => {
          if (i > 0 && plan[i].transition !== 'cut') events.push({ t: s.start - .1, kind: 'whoosh', gain: plan[i].transition === 'slide' ? .28 : .42 });
          for (const e of plan[i].sfx || []) events.push({ t: s.start + e.t, kind: e.kind, gain: .12 }); // vurgu: whoosh'tan belirgin şekilde kısık
        });
        for (const e of events) {
          const clip = await sfxPcm(e.kind); if (!clip) continue;
          const at = Math.max(0, Math.round(e.t * SAMPLE_RATE)) * 2;
          for (let k = 0; k < clip.length && at + k + 1 < pcm.length; k += 2) {
            const v = pcm.readInt16LE(at + k) + clip.readInt16LE(k) * e.gain;
            pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), at + k);
          }
        }
      }
      fs.writeFileSync(narration, Buffer.concat([wavHeader(pcm.length), pcm]));
      // Müzik altlığı: seçilen başlangıçtan döngü, giriş/çıkış geçişi, anlatım altında kısılır
      let soundtrack = narration;
      if (musicUnit) {
        send({ phase: 'assemble', pct: 100, message: 'Müzik karıştırılıyor…' });
        const total = pcm.length / 2 / SAMPLE_RATE, level = Math.max(.05, Math.min(1, +job.music.level || .3));
        soundtrack = path.join(tmp, 'soundtrack.wav');
        const r = await run(ffmpeg, ['-y', '-i', narration, '-stream_loop', '-1', '-i', musicUnit, '-filter_complex',
          `[1:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${level.toFixed(2)},afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, total - 2.5).toFixed(3)}:d=2.5[m];[0:a]aformat=channel_layouts=stereo,asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.02:ratio=4:attack=15:release=450:makeup=1[md];[v][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]`,
          '-map', '[out]', '-c:a', 'pcm_s16le', '-ar', String(SAMPLE_RATE), soundtrack]);
        check();
        if (r.code !== 0) { warnings.push('Müzik karıştırılamadı; müziksiz üretildi.'); soundtrack = narration; }
      }
      const list = path.join(tmp, 'segments.ffconcat');
      fs.writeFileSync(list, 'ffconcat version 1.0\n' + plan.map(p => `file '${p.out.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8');
      const outDir = job.outDir && fs.existsSync(job.outDir) ? job.outDir : app.getPath('downloads');
      const outFile = uniquePath(path.join(outDir, `${sanitizeName(title).slice(0, 80)} - ${format === 'podcast' ? 'Podcast' : 'Reels'}.mp4`));
      const mux = await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', soundtrack, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE), '-shortest', '-movflags', '+faststart', outFile + '.part.mp4']);
      check();
      if (mux.code !== 0) throw Error('Video birleştirilemedi: ' + tail(mux.stderr));
      fs.renameSync(outFile + '.part.mp4', outFile);
      if (credits.size) {
        try { fs.writeFileSync(outFile.replace(/\.mp4$/i, ' - kaynaklar.txt'), `Stok görseller: Pexels (pexels.com)\n\n${[...credits.values()].join('\n')}\n`, 'utf8'); } catch {}
      }
      // Kullanılmayan eski sahne görüntüleri/sesleri temizlenir (proje klasörü şişmesin)
      const keep = new Set([...plan.map(p => p.out), ...audio.flatMap(a => [a.file, a.file.slice(0, -4) + '.words.json'])]);
      for (const d of [segDir, audioDir]) for (const f of fs.readdirSync(d)) { const full = path.join(d, f); if (!keep.has(full)) fs.rmSync(full, { force: true }); }
      for (const f of fs.readdirSync(renderDir)) if (/\.html$/.test(f)) fs.rmSync(path.join(renderDir, f), { force: true });
      const total = timed.reduce((n, s) => n + s.duration, 0);
      return {
        ok: true, outFile, duration: total, warnings, rendered: todo.length, credits: credits.size, bpm: beat ? beat.bpm : null,
        scenes: timed.map(s => ({ id: s.id, start: s.start, end: +(s.start + s.duration).toFixed(4), speech: s.speech })),
        cues: VoiceScript.cuesFromTimings(timed)
      };
    } catch (err) {
      if (cancelled || err.cancelled) return { cancelled: true };
      return { error: err.message || String(err), warnings };
    } finally {
      busy = false;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });
}

module.exports = { register };
