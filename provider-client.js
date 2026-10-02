// Provider transport and model routing. Keys are sent only in headers, never logs.
const { createHash } = require('crypto');
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TEXT = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
const DEFAULT_TTS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
function parseChain(raw) {
  const names = (Array.isArray(raw) ? raw : String(raw || '').split(/[,\n]/)).map(s => String(s).trim().replace(/^models\//, '')).filter(Boolean);
  if (names.length > 8) throw Error('Bir zincirde en fazla 8 model olabilir.');
  if (names.some(name => !/^(gemini|gemma)-[a-z0-9.-]{1,100}$/.test(name))) throw Error('Model adı geçersiz. Her satıra bir Gemini model kimliği yazın.');
  return [...new Set(names)];
}
function classify(status, body = '') {
  if ([401, 403].includes(status) || status === 400 && /API_KEY_INVALID|API key not valid|API_KEY_EXPIRED/i.test(body)) return { retry: false, error: 'API anahtarı geçersiz, süresi dolmuş veya gerekli erişim izni yok. Anahtar ve proje izinlerini kontrol edin.' };
  if (status === 429) return { retry: true, error: 'Kota veya istek sınırına ulaşıldı. Sağlayıcı hesabındaki limitleri kontrol edin.' };
  if (status === 404) return { retry: true, error: 'Model bu hesap veya API sürümü için kullanılamıyor.' };
  if ([500, 502, 503, 504].includes(status)) return { retry: true, error: 'Sağlayıcı geçici hizmet hatası döndürdü.' };
  if (status === 400 && /not supported|unsupported|not available|not enabled/i.test(body)) return { retry: true, error: 'Model bu istek biçimini desteklemiyor.' };
  if (status === 402 || /quota_exceeded|insufficient.*credit/i.test(body)) return { retry: false, error: 'Hesap bakiyesi veya kullanım kotası yetersiz.' };
  return { retry: false, error: `İstek reddedildi (HTTP ${status}). Hesap erişimini ve istek ayarlarını kontrol edin.` };
}
function eligible(name, kind) {
  if (kind === 'tts') return /^gemini-/.test(name) && /(?:^|-)tts(?:-|$)/.test(name);
  return /^(gemini|gemma)-/.test(name) && !/tts|image|audio|live|embedding|robotics|computer-use|deep-research/.test(name);
}
function autoChain(names, kind) {
  const candidates = names.filter(n => eligible(n, kind) && (kind === 'tts' || /^gemini-\d+(?:\.\d+)?-flash(?:-|$)/.test(n)));
  candidates.sort((a, b) => Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)) || Number(/latest/.test(a)) - Number(/latest/.test(b)) || b.localeCompare(a, 'en', { numeric: true }));
  const defaults = kind === 'tts' ? DEFAULT_TTS : DEFAULT_TEXT;
  return [...new Set([...candidates.slice(0, 4), ...defaults])].slice(0, 8);
}
function createProviderClient({ fetchImpl = (...args) => fetch(...args), onAttempt = () => {}, timeoutMs = 120000, attemptMs = 40000 } = {}) {
  const cache = new Map();
  const fingerprint = key => createHash('sha256').update(key).digest('hex');
  async function request(url, options, ms = attemptMs) {
    const ctrl = new AbortController();
    const relay = () => ctrl.abort();
    if (options.signal?.aborted) ctrl.abort();
    options.signal?.addEventListener('abort', relay, { once: true });
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetchImpl(url, { ...options, signal: ctrl.signal });
      const body = await res.text();
      return { ok: res.ok, status: res.status, body, retryAfter: res.headers?.get('retry-after') };
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', relay); }
  }
  async function listModels(key, { signal, refresh = false } = {}) {
    if (!key) throw Error('Gemini API anahtarı boş.');
    const id = fingerprint(key), cached = cache.get(id);
    if (!refresh && cached && cached.until > Date.now()) return cached.models;
    const models = [], seen = new Set(); let token = '';
    for (let page = 0; page < 20; page++) {
      const res = await request(`${BASE}/models?pageSize=200${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { headers: { 'x-goog-api-key': key }, signal }, 15000);
      if (!res.ok) { const failure = classify(res.status, res.body); throw Object.assign(Error(failure.error), { status: res.status }); }
      const data = JSON.parse(res.body);
      if (!Array.isArray(data.models)) throw Error('Gemini model listesi beklenen biçimde değil.');
      for (const m of data.models) if (m.supportedGenerationMethods?.includes('generateContent')) {
        const name = String(m.name || '').replace(/^models\//, '');
        if (/^(gemini|gemma)-[a-z0-9.-]+$/.test(name)) models.push(name);
      }
      token = data.nextPageToken;
      if (!token) { const unique = [...new Set(models)]; cache.set(id, { models: unique, until: Date.now() + 300000 }); return unique; }
      if (seen.has(token)) throw Error('Gemini model listesi sayfalama hatası.'); seen.add(token);
    }
    throw Error('Gemini model listesi tamamlanamadı.');
  }
  async function generate({ key, chain, kind = 'text', body, setAbort = () => {}, isCancelled = () => false }) {
    if (!key) return { error: 'Gemini API anahtarı girilmemiş. Ayarlar → Bağlantılar bölümünden ekleyin.' };
    const ctrl = new AbortController(); setAbort(ctrl);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs); const attempts = [];
    try {
      if (isCancelled()) return { cancelled: true };
      let models = parseChain(chain);
      if (models.some(m => !eligible(m, kind))) return { error: 'Metin ve seslendirme modellerini ayrı zincirlere yazın.' };
      if (!models.length) {
        let available = [];
        try { available = await listModels(key, { signal: ctrl.signal }); }
        catch (err) { if ([400, 401, 403].includes(err.status)) return { error: err.message }; if (ctrl.signal.aborted) throw err; }
        models = autoChain(available, kind);
      }
      for (const model of models) {
        if (isCancelled() || ctrl.signal.aborted) break;
        let result;
        try {
          result = await request(`${BASE}/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: ctrl.signal, body: JSON.stringify(typeof body === 'function' ? body(model) : body) });
        } catch (err) {
          if (isCancelled() || ctrl.signal.aborted) break;
          if (err.name !== 'AbortError') return { error: 'Gemini bağlantısı kurulamadı. İnternet bağlantısını veya ağ erişimini kontrol edin.', attempts };
          const item = { kind, model, status: 0, ok: false, error: 'Model yanıtı zaman aşımına uğradı.' }; attempts.push(item); onAttempt(item); continue;
        }
        const item = { kind, model, status: result.status, ok: result.ok };
        attempts.push(item); onAttempt(item);
        if (!result.ok) {
          const failure = classify(result.status, result.body);
          if (!failure.retry) return { error: failure.error, attempts };
          item.error = failure.error;
          continue;
        }
        let data;
        try { data = JSON.parse(result.body); } catch { return { error: 'Gemini yanıtı çözümlenemedi.', attempts }; }
        const parts = data.candidates?.[0]?.content?.parts || [];
        if (data.promptFeedback?.blockReason || /SAFETY|PROHIBITED_CONTENT/.test(data.candidates?.[0]?.finishReason || '')) return { error: 'İçerik sağlayıcının güvenlik filtresi nedeniyle üretilemedi.', attempts };
        if (kind === 'tts') {
          const audio = parts.find(p => p.inlineData?.data)?.inlineData;
          if (audio) return { audio, model, attempts };
        } else {
          const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          try { if (text) return { data: JSON.parse(text), model, attempts }; } catch {}
        }
        return { error: 'Model yanıt verdi ancak beklenen içerik biçimi alınamadı. Metni veya modeli kontrol edin.', model, attempts };
      }
      if (isCancelled()) return { cancelled: true, attempts };
      if (ctrl.signal.aborted) return { error: 'Gemini işlemi zaman aşımına uğradı.', attempts };
      return { error: `Model zinciri tamamlandı; üretim yapılamadı. ${attempts.map(a => `${a.model}: ${a.status || 'zaman aşımı'}`).join(' → ')}. ${attempts.at(-1)?.error || ''}`, attempts };
    } catch (err) { return isCancelled() ? { cancelled: true } : { error: ctrl.signal.aborted ? 'Gemini işlemi zaman aşımına uğradı.' : err.message }; }
    finally { clearTimeout(timer); setAbort(null); }
  }
  async function testConnection(provider, key) {
    key = String(key || '').trim(); if (!key) return { error: 'Anahtar boş.' };
    try {
      if (provider === 'gemini') {
        const models = await listModels(key, { refresh: true });
        return { ok: true, models: models.filter(n => eligible(n, 'text')), ttsModels: models.filter(n => eligible(n, 'tts')), textChain: autoChain(models, 'text'), ttsChain: autoChain(models, 'tts'), message: 'Model listesine erişildi. Bu kontrol üretim kotasını veya her modelin çalışacağını garanti etmez.' };
      }
      const res = provider === 'eleven'
        ? await request('https://api.elevenlabs.io/v2/voices?page_size=1', { headers: { 'xi-api-key': key } }, 15000)
        : provider === 'pexels' ? await request('https://api.pexels.com/videos/search?query=nature&per_page=1', { headers: { Authorization: key } }, 15000) : null;
      if (!res) return { error: 'Sağlayıcı tanınmıyor.' };
      if (!res.ok) return { error: classify(res.status, res.body).error, status: res.status };
      const data = JSON.parse(res.body);
      if (!Array.isArray(provider === 'eleven' ? data.voices : data.videos)) return { error: 'Sağlayıcı beklenen listeyi döndürmedi.' };
      return { ok: true, message: provider === 'eleven' ? 'Ses listesine erişildi. Ses üretim izni ve kredi, üretim sırasında kontrol edilir.' : 'Video aramasına erişildi. Test, API istek kotasından bir istek kullanır.' };
    } catch (err) { return { error: err.name === 'AbortError' ? 'Bağlantı kontrolü zaman aşımına uğradı.' : err.status ? err.message : 'Bağlantı kontrolü tamamlanamadı. Ağ erişimini kontrol edin.' }; }
  }
  return { generate, listModels, testConnection };
}
module.exports = { createProviderClient, parseChain, classify, eligible, autoChain, DEFAULT_TEXT, DEFAULT_TTS };
