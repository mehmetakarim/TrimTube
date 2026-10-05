/* Reusable visual settings; project content never belongs to a brand profile. */
(() => {
  let profiles = [], busy = true;
  const panel = document.createElement('details'); panel.className = 'publish-profiles'; panel.id = 'publishProfiles';
  panel.innerHTML = '<summary>Yayın ve marka profilleri</summary><p>Logo, altyazı görünümü, başlık süresi, kalite ve oranları sakla. Video, kurgu ve metin değişmez.</p><label>Profil<select id="publishProfileSelect"><option value="">Profil seç</option></select></label><div class="profile-actions"><button id="publishProfileApply" class="btn-ghost small">Uygula</button><button id="publishProfileDelete" class="btn-ghost small">Sil</button></div><label>Yeni profil adı<input id="publishProfileName" maxlength="60" placeholder="Örn. Haftalık röportaj"></label><button id="publishProfileSave" class="btn-ghost small">Mevcut görünümü kaydet</button><span id="publishProfileStatus" role="status"></span>';
  $('proofOpen').before(panel);
  const status = text => $('publishProfileStatus').textContent = text;
  const bounded = (n, low, high, fallback) => Number.isFinite(+n) ? Math.max(low, Math.min(high, +n)) : fallback;
  function visual(p) {
    return {
      layouts: Object.fromEntries(['vertical','square','original'].filter(k => Number.isFinite(p.layouts?.[k]?.bottom) && Number.isFinite(p.layouts?.[k]?.side)).map(k => [k, {bottom:bounded(p.layouts[k].bottom,5,45,24),side:bounded(p.layouts[k].side,3,30,18)}])),
      quality: ['best','1080','720'].includes(p.quality) ? p.quality : 'best',
      formats: (Array.isArray(p.formats) ? p.formats : []).filter(f => ['original','vertical','square','gif'].includes(f)),
      style: ['klasik','dolgun','kutulu','vurgulu','pop'].includes(p.style) ? p.style : 'klasik',
      bottom: bounded(p.bottom,5,45,24), side: bounded(p.side,3,30,18),
      watermark: { enabled: !!p.watermark?.enabled, file: typeof p.watermark?.file === 'string' ? p.watermark.file : null, position: ['sag-ust','sol-ust','sag-alt','sol-alt'].includes(p.watermark?.position) ? p.watermark.position : 'sag-ust', size: bounded(p.watermark?.size,4,20,9) },
      seconds: [3,5,10].includes(+p.seconds) ? +p.seconds : 3
    };
  }
  function refresh(selected = $('publishProfileSelect').value) {
    const select = $('publishProfileSelect'); select.replaceChildren(new Option('Profil seç', ''));
    for (const p of profiles) select.add(new Option(p.name, p.id));
    select.value = selected;
    $('publishProfileApply').disabled = busy || !select.value || !infoLoaded || queueRunning;
    $('publishProfileDelete').disabled = busy || !select.value;
    $('publishProfileSave').disabled = busy || !infoLoaded || queueRunning;
  }
  async function persist(next, selected) {
    busy = true; refresh();
    try { await window.api.setSettings({ publishProfiles: next }); profiles = next; status('Profil kaydedildi · bu cihazda'); return true; }
    catch { status('Profil kaydedilemedi. Mevcut profiller korundu.'); return false; }
    finally { busy = false; refresh(selected); }
  }
  $('publishProfileSave').onclick = async () => {
    if (busy || !infoLoaded || queueRunning) return;
    const name = $('publishProfileName').value.trim();
    if (!name) { status('Profil için bir ad yaz.'); $('publishProfileName').focus(); return; }
    if (profiles.some(p => p.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) { status('Bu ad zaten var. Yeni bir ad kullan.'); return; }
    if (profiles.length >= 20) { status('En fazla 20 profil saklanabilir. Kullanmadığın bir profili sil.'); return; }
    const p = buildProject(), id = crypto.randomUUID();
    const settings = visual({ layouts:p.publishing?.layouts, quality:p.quality, formats:p.formats, style:p.subtitle.style, bottom:p.review?.bottom, side:p.review?.side, watermark:p.watermark, seconds:p.titleText.seconds });
    if (await persist([...profiles, { id, name, settings }], id)) $('publishProfileName').value = '';
  };
  $('publishProfileDelete').onclick = async () => {
    if (busy) return;
    if (await persist(profiles.filter(p => p.id !== $('publishProfileSelect').value), '')) status('Profil silindi. Çalışma ayarların değişmedi.');
  };
  $('publishProfileApply').onclick = () => {
    if (busy || !infoLoaded || queueRunning) return;
    const profile = profiles.find(p => p.id === $('publishProfileSelect').value); if (!profile) return;
    const p = visual(profile.settings), review = window.reviewProject();
    window.sessionCheckpoint?.();
    $('quality').value = p.quality; $('quality').dispatchEvent(new Event('change'));
    selectedFormats.clear(); (p.formats.length ? p.formats : ['original']).forEach(f => selectedFormats.add(f)); refreshFormatButtons();
    document.querySelector(`#subStyles [data-substyle="${p.style}"]`)?.click();
    watermarkFile = p.watermark.file; watermarkPos = p.watermark.position;
    $('wmFile').textContent = watermarkFile ? watermarkFile.split(/[\\/]/).pop() : 'Logo seçilmedi';
    document.querySelectorAll('#wmPos .wm-pos').forEach(b => b.classList.toggle('active',b.dataset.pos === watermarkPos));
    $('wmSize').value = p.watermark.size; $('wmEnable').checked = p.watermark.enabled && !!watermarkFile; $('wmEnable').dispatchEvent(new Event('change'));
    $('titleSeconds').value = p.seconds;
    window.reviewApplyProject({ ...review, bottom:p.bottom, side:p.side }, true);
    window.publishingApply?.({ ...window.publishingProject?.(), layouts:p.layouts });
    window.sessionCommit?.(); status(`“${profile.name}” uygulandı. Logo dosyasının bu cihazda bulunması gerekir; çıktı provasıyla kontrol et.`);
  };
  $('publishProfileSelect').onchange = () => refresh();
  document.addEventListener('change', () => refresh());
  const changed = window.studioSourceChanged;
  window.studioSourceChanged = (...args) => { changed?.(...args); refresh(); };
  refresh();
  window.api.getSettings().then(s => {
    profiles = Array.isArray(s.publishProfiles) ? s.publishProfiles.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.settings).slice(0,20).map(p => ({id:p.id,name:p.name.slice(0,60),settings:visual(p.settings)})) : [];
    busy = false; refresh();
  }).catch(() => { status('Profiller okunamadı. Kaydın üzerine yazmamak için yeniden açmayı dene.'); });
})();
