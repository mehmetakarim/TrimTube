const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const store = require('../transcript-store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trimtube-transcript-test-'));
let checks = 0;
try {
  const opts = { videoId: 'test', source: 'whisper', model: 'small' };
  const doc = { source: 'whisper', segments: [{start: 10, end: 12, text: 'Merhaba dünya'}], words: [{start:10.2,end:10.8,word:'Merhaba'}] };
  store.put(dir, opts, doc, {start:10,duration:5});
  assert.equal(store.get(dir, opts), null); checks++;
  assert.equal(store.get(dir, opts, {start:9,duration:5}), null); checks++;
  let part = store.get(dir, opts, {start:10.5,duration:1});
  assert.equal(part.segments[0].start,0); assert.equal(part.segments[0].end,1); assert.ok(Math.abs(part.words[0].end-.3)<1e-8); checks++;
  assert.equal(store.get(dir,{...opts,model:'base'},{start:10,duration:1}),null); checks++;
  store.put(dir,opts,doc);
  assert.equal(store.get(dir,opts).segments[0].start,10); checks++;
  assert.equal(store.get(dir,{...opts,videoId:'other'}),null); checks++;
  const yt = {...opts,source:'youtube',lang:'tr',auto:true}; store.put(dir,yt,doc);
  assert.equal(store.get(dir,{...yt,lang:'en'}),null); assert.equal(store.get(dir,{...yt,auto:false}),null); checks++;
  const localFile=path.join(dir,'source.mp4'); fs.writeFileSync(localFile,'one');
  store.put(dir,{...opts,localFile},doc); assert.ok(store.get(dir,{...opts,localFile}));
  fs.writeFileSync(localFile,'different'); assert.equal(store.get(dir,{...opts,localFile}),null); checks++;
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))) fs.writeFileSync(path.join(dir,name),'broken');
  assert.equal(store.get(dir,opts),null); checks++;
  console.log(`${checks} transcript-store checks passed`);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
