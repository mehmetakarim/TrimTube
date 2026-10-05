(() => {
  let layouts = {};
  const box = document.createElement('details'); box.className = 'publish-profiles'; box.id = 'publishPackagePanel';
  box.innerHTML = '<summary>Yayın paketi ve oranlara göre yerleşim</summary><label><span><input id="packageEnable" type="checkbox"> Kapak ve yayın dosyalarını hazırla</span></label><p>Videoların yanında ayrı bir klasöre kapak, yayın metni ve isteğe bağlı SRT kaydedilir. GIF ve ses çıktısında kullanılamaz.</p><label>Yayın başlığı<input id="packageTitle" maxlength="200"></label><label>Açıklama<textarea id="packageDescription" rows="3" maxlength="5000"></textarea></label><label>Kapak zamanı · çıktı saniyesi<input id="packageCover" type="number" min="0" step="0.1" value="0"></label><label><span><input id="packageSrt" type="checkbox"> Onaylı altyazıyı SRT olarak da kaydet</span></label><hr><label>Altyazı yerleşimi<select id="layoutFormat"><option value="vertical">9:16</option><option value="square">1:1</option><option value="original">Orijinal</option></select></label><label><span><input id="layoutEnabled" type="checkbox"> Bu oranda farklı boşluk kullan</span></label><label>Alt boşluk · %<input id="layoutBottom" type="number" min="5" max="45" value="24"></label><label>Yan boşluk · %<input id="layoutSide" type="number" min="3" max="30" value="18"></label><p>Bu ayarlar gerçek çıktı ve 5 sn provasında kullanılır. Kontrol masasındaki hızlı önizleme ortak yerleşimi gösterir.</p>';
  $('proofOpen').before(box);
  function draw() {
    const p = layouts[$('layoutFormat').value]; $('layoutEnabled').checked = !!p;
    $('layoutBottom').value = p?.bottom ?? 24; $('layoutSide').value = p?.side ?? 18;
    $('layoutBottom').disabled = $('layoutSide').disabled = !p;
  }
  $('layoutFormat').onchange = draw;
  for (const id of ['layoutEnabled','layoutBottom','layoutSide']) $(id).onchange = () => {
    const key = $('layoutFormat').value;
    if (!$('layoutEnabled').checked) delete layouts[key];
    else layouts[key] = {bottom:Math.max(5,Math.min(45,+$('layoutBottom').value || 24)),side:Math.max(3,Math.min(30,+$('layoutSide').value || 18))};
    draw();
  };
  window.publishingProject = () => ({ layouts:JSON.parse(JSON.stringify(layouts)), enabled:$('packageEnable').checked,title:$('packageTitle').value,description:$('packageDescription').value,coverTime:+$('packageCover').value,srt:$('packageSrt').checked });
  window.publishingApply = data => {
    layouts = {};
    for (const key of ['vertical','square','original']) { const p = data?.layouts?.[key]; if (Number.isFinite(p?.bottom) && Number.isFinite(p?.side)) layouts[key] = {bottom:Math.max(5,Math.min(45,p.bottom)),side:Math.max(3,Math.min(30,p.side))}; }
    $('packageEnable').checked=!!data?.enabled; $('packageTitle').value=String(data?.title || '').slice(0,200); $('packageDescription').value=String(data?.description || '').slice(0,5000); $('packageCover').value=Number.isFinite(data?.coverTime)?Math.max(0,data.coverTime):0; $('packageSrt').checked=!!data?.srt; draw();
  };
  window.publishingBuildOpts = opts => {
    const p = publishingProject(); opts.publishLayouts = p.layouts;
    if (!p.enabled) return;
    const total = opts.sequence ? TimelineData.duration(opts.sequence) : opts.trim ? parseTime(opts.trim.end)-parseTime(opts.trim.start) : opts.duration;
    if (opts.quality === 'audio' || opts.formats.includes('gif')) return 'Yayın paketi için GIF/ses yerine video formatlarını seç.';
    if (!Number.isFinite(p.coverTime) || p.coverTime < 0 || p.coverTime >= total) return 'Kapak zamanı çıktı süresinin içinde olmalı.';
    if (p.srt && !opts.subtitle) return 'SRT için altyazıyı etkinleştir, oluştur ve onayla.';
    opts.publishPackage = {enabled:true,title:p.title,description:p.description,coverTime:p.coverTime,srt:p.srt};
  };
  const changed=window.studioSourceChanged;
  window.studioSourceChanged=(...args)=>{changed?.(...args); $('packageCover').value=0; $('packageTitle').value=''; $('packageDescription').value='';};
  draw();
})();
