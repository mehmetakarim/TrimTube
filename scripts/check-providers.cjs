const assert = require('assert/strict');
const { createProviderClient, parseChain, autoChain, classify } = require('../provider-client');
const checks = [];
const response = (status, body) => new Response(JSON.stringify(body), { status });
const success = () => response(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
const model = name => ({ name: 'models/' + name, supportedGenerationMethods: ['generateContent'] });
async function test(label, fn) { await fn(); checks.push(label); }
async function run() {
  await test('Custom chain parsing normalizes and validates model IDs', () => {
    assert.deepEqual(parseChain(' models/gemini-3.8-flash,gemini-3.8-flash\ngemini-flash-latest'), ['gemini-3.8-flash','gemini-flash-latest']);
    assert.throws(() => parseChain('../settings')); assert.throws(() => parseChain(Array(9).fill('gemini-3.8-flash')));
  });
  for (const status of [404,429,500,503]) await test(`HTTP ${status} advances to next model`, async () => {
    const calls = [];
    const client = createProviderClient({ fetchImpl: async (url, opts) => { calls.push(url); assert.equal(opts.headers['x-goog-api-key'], 'secret'); assert.ok(!url.includes('secret')); return calls.length === 1 ? response(status,{}) : success(); } });
    const result = await client.generate({ key:'secret', chain:'gemini-old,gemini-new', body:{} });
    assert.equal(result.model,'gemini-new'); assert.equal(calls.length,2); assert.equal(result.data.ok,true);
  });
  for (const [status,body] of [[400,{error:'API_KEY_INVALID'}],[401,{}],[403,{}],[400,{error:'invalid argument'}]]) await test(`Terminal HTTP ${status} does not traverse models`, async () => {
    let calls=0; const client=createProviderClient({fetchImpl:async()=>{calls++;return response(status,body);}});
    const result=await client.generate({key:'secret',chain:'gemini-a,gemini-b',body:{}}); assert.ok(result.error);assert.equal(calls,1);
  });
  await test('Discovery paginates, filters capabilities and caches per credential', async () => {
    let count=0; const client=createProviderClient({fetchImpl:async url=>{count++;return url.includes('pageToken=')?response(200,{models:[model('gemini-3.8-flash-tts')]}):response(200,{models:[model('gemini-3.8-flash'),{name:'models/embed',supportedGenerationMethods:['embedContent']}],nextPageToken:'second'});}});
    const one=await client.listModels('a'); assert.equal(one.length,2); await client.listModels('a');assert.equal(count,2);await client.listModels('b');assert.equal(count,4);
    assert.ok(autoChain(one,'text').every(n=>!n.includes('tts')));assert.ok(autoChain(one,'tts').every(n=>n.includes('tts')));
  });
  await test('Key validation uses list API rather than a retired model', async () => {
    const client=createProviderClient({fetchImpl:async url=>{assert.ok(url.includes('/models?'));return response(200,{models:[model('gemini-3.8-flash')]});}});
    const r=await client.testConnection('gemini','a');assert.equal(r.ok,true);assert.ok(r.message.includes('garanti etmez'));
  });
  await test('Cancellation stops chain and releases caller controller', async () => {
    let ctrl,last,calls=0,cancelled=false;
    const client=createProviderClient({fetchImpl:async()=>{calls++;cancelled=true;ctrl.abort();return response(404,{});}});
    const r=await client.generate({key:'a',chain:'gemini-a,gemini-b',body:{},setAbort:c=>{last=c;if(c)ctrl=c;},isCancelled:()=>cancelled});assert.ok(r.cancelled);assert.equal(last,null);assert.equal(calls,1);
  });
  await test('Malformed and safety-filtered success responses do not retry', async () => {
    for(const data of [{candidates:[{content:{parts:[{text:'not JSON'}]}}]}, {promptFeedback:{blockReason:'SAFETY'}}]){
      let calls=0; const client=createProviderClient({fetchImpl:async()=>{calls++;return response(200,data);}});
      const r=await client.generate({key:'a',chain:'gemini-a,gemini-b',body:{}});assert.ok(r.error);assert.equal(calls,1);
    }
  });
  await test('TTS returns audio data and never routes through text models', async () => {
    const client=createProviderClient({fetchImpl:async()=>response(200,{candidates:[{content:{parts:[{inlineData:{mimeType:'audio/wav',data:'UklGRg=='}}]}}]})});
    const r=await client.generate({key:'a',chain:'gemini-3.8-flash-tts',kind:'tts',body:{}});assert.equal(r.audio.mimeType,'audio/wav');
    const bad=await client.generate({key:'a',chain:'gemini-3.8-flash',kind:'tts',body:{}});assert.ok(bad.error);
  });
  await test('Connection tests use provider-specific headers without generating media', async () => {
    const client=createProviderClient({fetchImpl:async(url,opts)=>{assert.ok(!opts.method); if(url.includes('elevenlabs')){assert.equal(opts.headers['xi-api-key'],'a');return response(200,{voices:[]});}assert.equal(opts.headers.Authorization,'a');return response(200,{videos:[]});}});
    assert.ok((await client.testConnection('eleven','a')).ok);assert.ok((await client.testConnection('pexels','a')).ok);
  });
  await test('Network errors cannot echo credentials in UI errors', async () => {
    const client=createProviderClient({fetchImpl:async()=>{throw Error('https://example?key=secret');}});
    const r=await client.generate({key:'secret',chain:'gemini-a',body:{}});assert.ok(!r.error.includes('secret'));
  });
  await test('Per-model timeout is bounded and moves to fallback', async () => {
    let calls=0;const client=createProviderClient({attemptMs:10,fetchImpl:async(url,opts)=>{if(++calls===2)return success();return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))));}});
    const r=await client.generate({key:'a',chain:'gemini-a,gemini-b',body:{}});assert.ok(r.data.ok);assert.equal(calls,2);
  });
  console.log(JSON.stringify({checks},null,2));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
