const fs = require('fs');
const keys = ['geminiKey','elevenKey','pexelsKey'];
function createStore({file, safeStorage, platform=process.platform, defaults={}, io=fs}) {
  let raw=null, current=null, warning='', revision=0;
  const available=()=> { try { return !!safeStorage?.isEncryptionAvailable() && (platform!=='linux' || !['basic_text','unknown'].includes(safeStorage.getSelectedStorageBackend())); } catch {return false;} };
  function write(next) {
    const tmp=file()+'.pending';
    try {io.writeFileSync(tmp,JSON.stringify(next,null,2),'utf8');io.renameSync(tmp,file());}
    finally {try {io.unlinkSync(tmp);}catch{}}
  }
  function load() {
    if(current) return current;
    try {raw=JSON.parse(io.readFileSync(file(),'utf8'));} catch(err) {if(err.code!=='ENOENT') throw Error('Ayar dosyası okunamadı; mevcut dosya korunuyor.'); raw={};}
    current={...defaults,...raw}; delete current.encryptedKeys;
    for(const key of keys) {
      current[key]=typeof raw[key]==='string'?raw[key]:'';
      if(raw.encryptedKeys?.[key]) {
        try {if(!available()) throw Error(); current[key]=safeStorage.decryptString(Buffer.from(raw.encryptedKeys[key],'base64'));}
        catch {current[key]='';warning='Kayıtlı anahtar çözülemedi. İşletim sistemi kasasını açıp uygulamayı yeniden başlatın veya anahtarı yenileyin.';}
      }
    }
    if(keys.some(k=>raw[k])) {
      try { save({}); }
      catch {warning='Eski anahtarlar henüz şifrelenemedi; mevcut dosya korundu. Güvenli depoyu açıp uygulamayı yeniden başlatın.';}
    }
    return current;
  }
  function save(patch) {
    load();
    if(Object.hasOwn(patch,'encryptedKeys')) throw Error('Şifreli anahtar alanı doğrudan değiştirilemez.');
    const next={...raw,...patch,encryptedKeys:{...raw.encryptedKeys}}, memory={...current,...patch};
    for(const key of keys) {
      const changed=Object.hasOwn(patch,key), legacy=!!raw[key];
      if(changed || legacy) {
        const value=String(changed?patch[key]||'':current[key]).trim();
        if(value) {if(!available()) throw Error('Güvenli anahtar deposu kullanılamıyor. Anahtar kaydedilmedi.'); const encrypted=safeStorage.encryptString(value); if(safeStorage.decryptString(encrypted)!==value) throw Error('Şifreleme doğrulanamadı. Mevcut kayıt korundu.'); next.encryptedKeys[key]=encrypted.toString('base64');}
        else delete next.encryptedKeys[key];
        memory[key]=value;
      }
      delete next[key];
    }
    write(next); raw=next;current=memory; if(!keys.some(k=>raw.encryptedKeys?.[k]&&!current[k])) warning=''; revision++;return current;
  }
  function publicSettings() {
    const result={...load()};delete result.encryptedKeys;
    // Compatibility tokens express availability only; never contain credentials.
    for(const key of keys) result[key]=current[key]?`stored:${revision}`:'';
    result.credentialStorage={available:available(),warning,locked:keys.filter(k=>raw.encryptedKeys?.[k]&&!current[k])};
    return result;
  }
  return {load,save,publicSettings};
}
module.exports={createStore};
