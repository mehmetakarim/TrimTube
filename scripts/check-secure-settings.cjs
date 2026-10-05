const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {createStore}=require('../secure-settings');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trimtube-vault-test-')),file=()=>path.join(dir,'settings.json');
const safe={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'gnome_libsecret',encryptString:s=>Buffer.from('cipher:'+s),decryptString:b=>{if(!b.toString().startsWith('cipher:'))throw Error();return b.toString().slice(7);}};
const make=(extra={})=>createStore({file,safeStorage:safe,...extra});let checks=0;
try {
 fs.writeFileSync(file(),JSON.stringify({geminiKey:'legacy-secret',elevenKey:'voice-secret',pexelsKey:'stock-secret',theme:'dark'}));
 const s=make(); assert.equal(s.load().geminiKey,'legacy-secret'); const raw=fs.readFileSync(file(),'utf8'); assert.ok(!raw.includes('legacy-secret')&&!raw.includes('voice-secret')&&!raw.includes('stock-secret'));checks++;
 assert.equal(make().load().geminiKey,'legacy-secret');checks++;
 const pub=JSON.stringify(s.publicSettings());assert.ok(!pub.includes('legacy-secret')&&!pub.includes('encryptedKeys'));checks++;
 s.save({theme:'light'});assert.equal(make().load().elevenKey,'voice-secret');checks++;
 s.save({geminiKey:''});assert.equal(make().load().geminiKey,'');checks++;
 const locked=make({safeStorage:{...safe,decryptString:()=>{throw Error();}}});assert.equal(locked.load().elevenKey,'');locked.save({theme:'dark'});assert.equal(make().load().elevenKey,'voice-secret');checks++;
 const linux=make({platform:'linux',safeStorage:{...safe,getSelectedStorageBackend:()=> 'basic_text'}});assert.throws(()=>linux.save({geminiKey:'new-secret'}),/Güvenli/);assert.ok(!fs.readFileSync(file(),'utf8').includes('new-secret'));checks++;
 fs.writeFileSync(file(),JSON.stringify({geminiKey:'keep-on-failure'}));const before=fs.readFileSync(file(),'utf8');
 const blocked=make({io:{...fs,renameSync:()=>{throw Error('test write failure');}}});assert.equal(blocked.load().geminiKey,'keep-on-failure');assert.equal(fs.readFileSync(file(),'utf8'),before);assert.ok(blocked.publicSettings().credentialStorage.warning);checks++;
 const unavailable=make({safeStorage:{isEncryptionAvailable:()=>false}});assert.equal(unavailable.load().geminiKey,'keep-on-failure');assert.equal(fs.readFileSync(file(),'utf8'),before);checks++;
 fs.writeFileSync(file(),'broken');assert.throws(()=>make().save({theme:'light'}),/korunuyor/);assert.equal(fs.readFileSync(file(),'utf8'),'broken');checks++;
 console.log(`${checks} secure settings checks passed`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
