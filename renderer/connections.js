(() => {
  const host = $('setGeminiKey').closest('.setting-group');
  const fields = [['gemini', 'Gemini', 'İçerik Asistanı, hikâye planı ve Google seslendirmesi', 'geminiKey', 'setGeminiKey'], ['eleven', 'ElevenLabs', 'İsteğe bağlı seslendirme', 'elevenKey', 'setElevenKey'], ['pexels', 'Pexels', 'Destek görüntüsü araması', 'pexelsKey', 'setPexelsKey']];
  const existing = Object.fromEntries(fields.map(([id,,,,field]) => [id, $(field)]));
  const pageButtons = { gemini: $('geminiKeyPageBtn'), pexels: $('pexelsKeyPageBtn') };
  host.replaceChildren(); host.classList.add('connections');
  let saveTail = Promise.resolve(), initialized = false;
  const states = {};
  const message = (id, text, kind = '') => { const el = $(`${id}KeyStatus`); el.textContent = text; el.dataset.state = kind; };
  async function persist(id) {
    const s = states[id], value = s.input.value.trim(), revision = s.revision;
    message(id, 'Kaydediliyor…');
    const operation = saveTail.catch(() => {}).then(() => window.api.providerSave({ [s.setting]: value })); saveTail = operation;
    let result; try { result = await operation; } catch { result = { error: 'Ayar kaydedilemedi. Yeniden deneyin.' }; }
    if (result?.ok) {
      settings[s.setting] = value;
      if (id === 'eleven') mdVoicesLoaded = false;
      window.workspaceRefresh?.();
    }
    if (revision === s.revision) message(id, result?.ok ? (value ? 'Kaydedildi · henüz doğrulanmadı' : 'Anahtar kaldırıldı') : result?.error || 'Kaydedilemedi', result?.ok ? '' : 'error');
    return result?.ok && revision === s.revision;
  }
  for (const [id, title, purpose, setting] of fields) {
    const card = document.createElement('section'); card.className = 'connection-card';
    card.innerHTML = `<div class="connection-heading"><strong>${title}</strong><span>${purpose}</span></div><label class="connection-key-label" for="${existing[id].id}">API anahtarı</label><div class="connection-key"></div><div class="connection-actions"><button id="${id}KeySaveBtn" class="btn-ghost small">Kaydet</button><button id="${id}KeyTestBtn" class="btn-ghost small">Bağlantıyı test et</button></div><p id="${id}KeyStatus" class="connection-status" role="status">Henüz doğrulanmadı</p>`;
    const input = existing[id]; card.querySelector('.connection-key').append(input);
    const reveal = document.createElement('button'); reveal.className = 'btn-ghost small'; reveal.textContent = 'Göster'; reveal.type = 'button'; reveal.setAttribute('aria-label', `${title} anahtarını göster`); reveal.setAttribute('aria-pressed', 'false');
    reveal.onclick = () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; reveal.textContent = show ? 'Gizle' : 'Göster'; reveal.setAttribute('aria-pressed', String(show)); };
    card.querySelector('.connection-key').append(reveal);
    if (pageButtons[id]) card.querySelector('.connection-actions').append(pageButtons[id]);
    host.append(card);
    const state = states[id] = { input, setting, revision: 0 };
    input.addEventListener('input', () => { state.revision++; message(id, 'Değişiklik kaydedilmedi'); if (id === 'gemini') { $('modelCatalog').replaceChildren(); $('modelCatalogStatus').textContent = 'Anahtar değişti. Modelleri görmek için bağlantıyı yeniden test edin.'; } });
    input.addEventListener('change', () => { persist(id); });
    $(`${id}KeySaveBtn`).onclick = () => persist(id);
    $(`${id}KeyTestBtn`).onclick = async () => {
      const button = $(`${id}KeyTestBtn`), revision = state.revision;
      button.disabled = true;
      try {
        if (!await persist(id) || revision !== state.revision) return;
        message(id, 'Bağlantı kontrol ediliyor…');
        const result = await window.api.providerTest({ provider: id, key: input.value.trim() });
        if (revision !== state.revision) return;
        message(id, result?.ok ? `✓ ${result.message}` : result?.error || 'Kontrol tamamlanamadı.', result?.ok ? 'ok' : 'error');
        if (id === 'gemini' && result?.ok) catalog(result);
      } catch { if (revision === state.revision) message(id, 'Bağlantı kontrolü tamamlanamadı. Yeniden deneyin.', 'error'); }
      finally { button.disabled = false; }
    };
  }
  $('geminiKeyPageBtn').onclick = () => window.api.openGeminiKeyPage();
  $('pexelsKeyPageBtn').onclick = () => window.api.openPexelsKeyPage();
  const models = document.createElement('details'); models.className = 'connection-card model-routing';
  models.innerHTML = `<summary>Gemini model seçimi ve tanılama</summary><div class="connection-heading"><strong>Gemini model sırası</strong><span>Model kullanılamazsa, kotaya takılırsa veya geçici hizmet hatası verirse sıradaki denenir.</span></div><p class="connection-note">Boş bırak: canlı listeden otomatik seç. Özel sıra: her satıra bir model kimliği yaz (en fazla 8). Metin ve seslendirme ayrı tutulur. Alternatif modellerin fiyatları ve kotaları değişebilir.</p><label for="geminiModelChain">Metin üretimi</label><textarea id="geminiModelChain" rows="3" spellcheck="false" placeholder="Otomatik · canlı model keşfi"></textarea><label for="geminiTtsChain">Google seslendirmesi</label><textarea id="geminiTtsChain" rows="3" spellcheck="false" placeholder="Otomatik · seslendirme modelleri"></textarea><div class="connection-actions"><button id="modelChainSave" class="btn-ghost small">Model sırasını kaydet</button><button id="modelChainReset" class="btn-ghost small">Otomatik seçime dön</button></div><p id="modelChainStatus" role="status" class="connection-status"></p><label for="modelCatalog">Canlı model listesi</label><div class="connection-actions"><select id="modelCatalog" aria-label="Kullanılabilir Gemini modelleri"></select><button id="modelCatalogAdd" class="btn-ghost small">Sıraya ekle</button></div><p id="modelCatalogStatus" class="connection-note">Modelleri görmek için Gemini bağlantısını test edin. Listeye erişim, üretim garantisi değildir.</p><details><summary>Bu oturumda denenen modeller</summary><ol id="providerHistory" class="provider-history"></ol></details>`;
  host.insertBefore(models, host.children[1]);
  const note = document.createElement('p'); note.className = 'connection-note'; note.textContent = 'Anahtarlar bu bilgisayardaki ayar dosyasında saklanır; yalnızca ilgili sağlayıcıya gönderilir. Bağlantı testleri içerik veya ses üretmez. Pexels testi bir arama isteği kullanır.'; host.append(note);
  let chainRevision = 0;
  for (const id of ['geminiModelChain', 'geminiTtsChain']) $(id).oninput = () => { chainRevision++; $('modelChainStatus').textContent = 'Model sırası kaydedilmedi'; };
  $('modelChainSave').onclick = async () => {
    const revision = chainRevision, button = $('modelChainSave'); button.disabled = true;
    const patch = { geminiModelChain: $('geminiModelChain').value.trim(), geminiTtsChain: $('geminiTtsChain').value.trim() };
    try {
      const operation = saveTail.catch(() => {}).then(() => window.api.providerSave(patch)); saveTail = operation;
      const result = await operation;
      if (result?.ok) Object.assign(settings, patch);
      if (revision === chainRevision) $('modelChainStatus').textContent = result?.ok ? 'Model sırası kaydedildi · sonraki üretimde uygulanır' : result?.error || 'Kaydedilemedi';
    } catch { $('modelChainStatus').textContent = 'Ayar kaydedilemedi. Yeniden deneyin.'; }
    finally { button.disabled = false; }
  };
  $('modelChainReset').onclick = () => { for (const id of ['geminiModelChain', 'geminiTtsChain']) { $(id).value = ''; $(id).dispatchEvent(new Event('input')); } $('modelChainSave').click(); };
  function catalog(result) {
    const select = $('modelCatalog'); select.replaceChildren();
    for (const [label, names, kind] of [['Metin', result.models || [], 'text'], ['Seslendirme', result.ttsModels || [], 'tts']]) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const name of names) { const option = document.createElement('option'); option.value = name; option.textContent = name; option.dataset.kind = kind; group.append(option); }
      select.append(group);
    }
    $('modelCatalogStatus').textContent = `Otomatik metin sırası: ${(result.textChain || []).join(' → ')}. Seslendirme sırası: ${(result.ttsChain || []).join(' → ')}. Listeye erişim üretim garantisi değildir.`;
  }
  $('modelCatalogAdd').onclick = () => {
    const option = $('modelCatalog').selectedOptions[0]; if (!option) return;
    const input = $(option.dataset.kind === 'tts' ? 'geminiTtsChain' : 'geminiModelChain');
    const chain = input.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    if (!chain.includes(option.value)) chain.push(option.value);
    input.value = chain.join('\n'); input.dispatchEvent(new Event('input'));
  };
  function record(item) {
    const row = document.createElement('li'); row.textContent = `${new Date(item.at).toLocaleTimeString('tr-TR')} · ${item.kind === 'tts' ? 'Ses' : 'Metin'} · ${item.model} · ${item.status || 'zaman aşımı'}${item.ok ? ' · yanıt alındı' : ''}`;
    $('providerHistory').prepend(row); while ($('providerHistory').children.length > 20) $('providerHistory').lastChild.remove();
  }
  window.api.onProviderAttempt(record);
  window.api.providerHistory().then(items => (items || []).forEach(record)).catch(() => {});
  window.connectionsInit = () => {
    if (!settings || initialized) return; initialized = true;
    for (const id of ['geminiModelChain', 'geminiTtsChain']) $(id).value = settings[id] || '';
    for (const [id,,,setting] of fields) message(id, settings[setting] ? 'Kayıtlı · henüz doğrulanmadı' : 'Anahtar eklenmedi');
  };
  window.connectionsInit();
})();
