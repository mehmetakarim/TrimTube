/* Short output render, deliberately sharing the production export pipeline. */
(() => {
  let busy=false, token=0, id=null, signature='', returnFocus=null, checkTimer;
  const trigger=document.createElement('button'); trigger.id='proofOpen'; trigger.className='btn-ghost'; trigger.textContent='5 sn gerçek çıktı provası';
  document.querySelector('.download-row').before(trigger);
  const modal=document.createElement('div'); modal.id='proofModal'; modal.className='modal-overlay hidden'; modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-label','Gerçek çıktı provası');
  modal.innerHTML='<section class="proof-card"><header><div><strong>Gerçek çıktı provası</strong><p>Altyazı, kadraj ve marka öğeleri dışa aktarma motoruyla işlenir.</p></div><button id="proofClose" class="btn-ghost" aria-label="Provayı kapat">✕</button></header><div class="proof-options"><label>Çıktıda başlangıç (sn)<input id="proofStart" type="number" min="0" step="0.1" value="0"></label><label>Format<select id="proofFormat"></select></label><button id="proofGenerate" class="btn-download">5 saniyeyi hazırla</button></div><p id="proofStatus" role="status">Önce kısa bir çıktı oluştur, sonra oynatarak kontrol et.</p><video id="proofVideo" controls playsinline class="hidden"></video><p class="proof-note">En fazla 5 saniye gösterilir. Kurgu birleştirme ve kaynağı hazırlama süresi ayrıca gerekir. Bu dosya geçicidir.</p></section>';
  document.body.append(modal);
  const video=$('proofVideo'), status=text=>$('proofStatus').textContent=text;
  async function release() {
    video.pause(); video.removeAttribute('src'); video.load(); video.classList.add('hidden');
    const old=id; id=null; if(old) { await new Promise(resolve=>setTimeout(resolve,100)); await window.api.outputProofCleanup(old).catch(()=>{}); }
  }
  function fingerprint() { const r=buildOpts(); return r.error ? null : JSON.stringify([r.opts,+$('proofStart').value,$('proofFormat').value]); }
  function setBusy(value) { busy=value; window.outputProofBusy=value; $('proofGenerate').textContent=value?'İptal et':'5 saniyeyi hazırla'; }
  function open() {
    returnFocus=document.activeElement; $('preview').pause(); $('tpVideo').pause();
    $('proofFormat').replaceChildren();
    for(const format of selectedFormats) if(['original','vertical','square'].includes(format)) { const option=document.createElement('option'); option.value=format; option.textContent={original:'Orijinal',vertical:'9:16',square:'1:1'}[format]; $('proofFormat').append(option); }
    const total=window.sequenceProject?.().enabled?TimelineData.duration(window.sequenceProject().clips):currentRange().duration;
    $('proofStart').max=Math.max(0,total-.1); $('proofStart').value=0;
    signature=''; release(); modal.classList.remove('hidden'); $('proofClose').focus(); status('Çıktıdaki başlangıcı ve formatı seç. Onaylı düzenlemeler kullanılacak.');
  }
  trigger.onclick=open;
  const reviewTrigger=document.createElement('button'); reviewTrigger.id='reviewProof'; reviewTrigger.className='btn-ghost'; reviewTrigger.textContent='Çıktı provası';
  $('reviewExport').before(reviewTrigger); reviewTrigger.onclick=()=> { if(window.reviewApprove?.()) open(); };
  async function close() { token++; if(busy) await window.api.outputProofCancel(); await release(); modal.classList.add('hidden'); returnFocus?.focus(); }
  $('proofClose').onclick=close; modal.onclick=e=> {if(e.target===modal) close();};
  $('proofGenerate').onclick=async()=> {
    if(busy) { token++; await window.api.outputProofCancel(); status('Prova iptal ediliyor…'); return; }
    if(queueRunning||tp.generating) {status('Devam eden işlemin tamamlanmasını bekle.');return;}
    const r=buildOpts(); if(r.error) {status(r.error);return;}
    const start=+$('proofStart').value, format=$('proofFormat').value;
    if(!Number.isFinite(start)||start<0||!format) {status('Geçerli başlangıç ve video formatı seç.');return;}
    const own=++token; signature=fingerprint(); setBusy(true);status('Gerçek çıktı hazırlanıyor…');
    try {
      await release(); if(own!==token) return;
      const result=await window.api.outputProof({opts:r.opts,start,format});
      if(own!==token||signature!==fingerprint()) { if(result?.id) await window.api.outputProofCleanup(result.id); if(!modal.classList.contains('hidden')) status('Prova iptal edildi veya ayarlar değişti. Yeniden oluştur.'); return; }
      if(result.error) throw Error(result.error);
      if(result.cancelled) {status('Prova iptal edildi.');return;}
      id=result.id; video.src=result.url;video.classList.remove('hidden');status(`${result.duration.toFixed(2)} sn gerçek çıktı hazır. Oynatarak kontrol et.`);
    } catch(err) {if(own===token) status(err.message);}
    finally {setBusy(false);}
  };
  function changed() {
    clearTimeout(checkTimer);checkTimer=setTimeout(()=> {
      if(signature && signature!==fingerprint()) {token++;signature=''; if(busy) window.api.outputProofCancel();release();status('Düzenlemeler değişti. Güncel çıktı için provayı yeniden oluştur.');}
    },100);
  }
  for(const event of ['input','change','click']) document.addEventListener(event,e=> {if(!e.target.closest('#proofModal') || e.target.matches('#proofStart,#proofFormat')) changed();});
  const sourceChanged=window.studioSourceChanged;
  window.studioSourceChanged=(...args)=> {token++; signature='';if(busy) window.api.outputProofCancel();release();sourceChanged?.(...args);};
  modal.onkeydown=e=> {
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    if(e.key==='Tab'){ const items=[...modal.querySelectorAll('button,input,select,video')].filter(el=>!el.disabled&&!el.classList.contains('hidden'));const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} }
  };
})();
