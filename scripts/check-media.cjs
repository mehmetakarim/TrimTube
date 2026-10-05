// Real local FFmpeg/tracker integration through production IPC handlers.
// Electron app lifecycle and updater are stubbed; no network or user settings.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build/media-qa'); fs.mkdirSync(out, { recursive: true });
const userData = path.join(out, 'profile'); fs.mkdirSync(path.join(userData, 'cache'), { recursive: true });
const nativeRequire = createRequire(path.join(root, 'main.js'));
const ffmpeg = nativeRequire('ffmpeg-static');
function ff(args) {
  const r = spawnSync(ffmpeg, ['-y', ...args], { windowsHide: true, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r;
}
const source = path.join(out, 'source.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=16000', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', source]);
const handlers = new Map(), events = [];
const app = { isPackaged: false, getPath: () => userData, requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}), getVersion: () => 'test' };
const electron = { safeStorage: {isEncryptionAvailable:()=>true, getSelectedStorageBackend:()=> 'gnome_libsecret', encryptString:s=>Buffer.from('test:'+s), decryptString:b=>b.toString().slice(5)}, app, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: {}, shell: {} };
const context = vm.createContext({
  require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: {} } : nativeRequire(name),
  __dirname: root, __filename: path.join(root, 'main.js'), console,
  process: { platform: process.platform, env: process.env, argv: [], on() {} },
  Buffer, URL, setTimeout, clearTimeout, AbortController,
  fetch: () => { throw Error('Network is disabled in local media tests'); }
});
vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8') + '\nwin = {webContents:{send:(...args)=>globalThis.events.push(args)}}; getEncoder = async () => "libx264"; globalThis.titleAss = writeTitleAss; globalThis.karaokeAss = writeKaraokeAss; globalThis.subtitleWords = srtToWords; globalThis.generateTts = geminiTts; globalThis.generateText = geminiRequest;', Object.assign(context, { events }));
const invoke = (name, data) => handlers.get(name)({}, data);
const checks = [];
const base = { localFile: source, id: 'qa', title: 'Yerel test', folder: out, quality: 'best', formats: ['original'], duration: 2 };
async function main() {
  const store = require('../transcript-store');
  const sharedSource = path.join(out, 'shared-source.mp4'); fs.copyFileSync(source, sharedSource);
  const sharedOpts = { videoId: 'shared-qa', localFile: sharedSource, source: 'whisper', model: 'small' };
  store.put(path.join(userData,'cache'), sharedOpts, { source:'whisper',model:'small',segments:[{start:0,end:2,text:'Ortak metin'}],words:[{start:.2,end:.7,word:'Ortak'},{start:1,end:1.8,word:'metin'}] });
  const sharedAi = await invoke('ai-transcript',sharedOpts);
  assert.ok(sharedAi.ok && sharedAi.cachedHit); assert.equal(sharedAi.words[0].start,.2);
  checks.push('AI transcript reuses shared recognition with acoustic words');
  const sharedReview = await invoke('subtitle-review',{...sharedOpts,start:.5,duration:1});
  assert.ok(sharedReview.cachedHit,sharedReview.error); assert.match(sharedReview.srt,/Ortak metin/); assert.equal(sharedReview.words[0].start,0);
  checks.push('Subtitle review reuses full transcript and shifts words to the requested clip');

  const sequence = [{ id: 'b', start: 1, end: 1.75 }, { id: 'a', start: 0, end: .5 }, { id: 'c', start: 1, end: 1.25 }];
  const assembled = await invoke('download', { ...base, title: 'Kurgu testi', sequence });
  assert.ok(assembled.ok, assembled.error);
  const sequenceProbe = spawnSync(ffmpeg, ['-i', assembled.files[0]], { windowsHide: true, encoding: 'utf8' }).stderr;
  assert.match(sequenceProbe, /Duration: 00:00:01\.5/); assert.match(sequenceProbe, /Audio: aac/);
  checks.push('Timeline reordered and repeated cuts export with audio and correct duration');
  const colourSource = path.join(out, 'order-source.mp4');
  ff(['-f','lavfi','-i','color=red:s=160x90:r=24:d=1','-f','lavfi','-i','color=blue:s=160x90:r=24:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=1','-f','lavfi','-i','sine=frequency=880:sample_rate=16000:duration=1','-filter_complex','[0:v][2:a][1:v][3:a]concat=n=2:v=1:a=1[v][a]','-map','[v]','-map','[a]','-c:v','libx264','-c:a','aac',colourSource]);
  const reversed = await invoke('download', { ...base, localFile: colourSource, title: 'Renk sırası', sequence: [{ start: 1, end: 1.5 }, { start: 0, end: .5 }] });
  assert.ok(reversed.ok, reversed.error);
  const pixel = time => spawnSync(ffmpeg, ['-ss',String(time),'-i',reversed.files[0],'-vf','scale=1:1','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'], {windowsHide:true}).stdout;
  const blue = pixel(.1), red = pixel(.65); assert.ok(blue[2] > 180 && blue[0] < 60); assert.ok(red[0] > 180 && red[2] < 60);
  const tone = time => {
    const decoded = spawnSync(ffmpeg, ['-ss',String(time),'-i',reversed.files[0],'-t','0.25','-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'], {windowsHide:true});
    assert.equal(decoded.status, 0, decoded.stderr.toString()); const bytes = decoded.stdout;
    let crossings = 0; for (let i = 4; i < bytes.length; i += 4) if (bytes.readFloatLE(i - 4) < 0 && bytes.readFloatLE(i) >= 0) crossings++;
    return crossings / (bytes.length / 4 / 16000);
  };
  const firstTone = tone(.1), secondTone = tone(.6);
  assert.ok(Math.abs(firstTone - 880) < 30, `First tone: ${firstTone}`); assert.ok(Math.abs(secondTone - 440) < 30, `Second tone: ${secondTone}`);
  checks.push('Decoded colour frames and audio tones prove reordered picture and sound');
  const proof = await invoke('output-proof',{opts:{...base,localFile:colourSource,sequence:[{start:1,end:1.5},{start:0,end:.5}]},start:.5,format:'original'});
  assert.ok(proof.url,proof.error);
  const proofPath=require('url').fileURLToPath(proof.url);
  const proofPixel=spawnSync(ffmpeg,['-i',proofPath,'-vf','scale=1:1','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true}).stdout;
  assert.ok(proofPixel[0]>180 && proofPixel[2]<60);assert.equal(proof.duration,.5);
  await invoke('output-proof-cleanup',proof.id);assert.ok(!fs.existsSync(proofPath));checks.push('Real proof uses output timeline order and removes its temporary video');
  assert.ok((await invoke('output-proof',{opts:base,start:2,format:'original'})).error);checks.push('Out-of-range proof stops before rendering');
  const remapped = await invoke('download', { ...base, title: 'Kurgu altyazı kadraj', sequence, formats: ['vertical'], framingPath: [{ t: 0, x: 0 }, { t: 1, x: .5 }], subtitle: { source: 'edited', style: 'vurgulu', srt: '1\n00:00:00,000 --> 00:00:01,000\nİlk sahne\n\n2\n00:00:01,000 --> 00:00:02,000\nSon sahne\n' } });
  assert.ok(remapped.ok, remapped.error); checks.push('Timeline remaps approved subtitle and camera events into a real vertical export');
  const originalPush = events.push;
  let cancelled = false;
  events.push = function (...items) { for (const event of items) if (!cancelled && event[0] === 'progress') { cancelled = true; invoke('cancel'); } return originalPush.apply(this, items); };
  const stopped = await invoke('download', { ...base, title: 'İptal edilen kurgu', sequence }); events.push = originalPush;
  assert.ok(stopped.cancelled); assert.ok(!fs.existsSync(path.join(out, 'İptal edilen kurgu [kurgu].mp4')));
  checks.push('Cancelling assembly stops before final export');
  const assembledAudio = await invoke('download', { ...base, title: 'Kurgu ses', sequence, quality: 'audio' });
  assert.ok(assembledAudio.ok, assembledAudio.error); checks.push('Timeline assembly exports MP3');
  const outside = await invoke('download', { ...base, sequence: [{ start: 0, end: 3 }] });
  assert.equal(outside.ok, false); checks.push('Backend rejects out-of-source timeline intervals');
  const draft = { ...base, sequence: { enabled: true, clips: sequence } };
  assert.ok((await invoke('project-draft-save', draft)).ok);
  assert.equal((await invoke('project-draft-read')).draft.project.sequence.clips.length, 3);
  checks.push('Recovery draft atomically round-trips ordered cuts');
  const audio = await invoke('download', { ...base, quality: 'audio' });
  assert.ok(audio.ok, audio.error); assert.ok(audio.files[0].endsWith('.mp3'));
  const probe = spawnSync(ffmpeg, ['-i', audio.files[0]], { windowsHide: true, encoding: 'utf8' });
  assert.match(probe.stderr, /Audio: mp3/); assert.doesNotMatch(probe.stderr, /Video:/);
  checks.push('Untrimmed local source produces actual MP3');
  fs.writeFileSync(path.join(userData, 'cache/qa_sub_tr.srt'), '1\n00:00:00,000 --> 00:00:02,000\nTürkçe altyazı: çığ, öykü, şarkı.\n');
  const branded = await invoke('download', { ...base, title: 'Markalı test', subtitle: { source: 'edited', srt: fs.readFileSync(path.join(userData, 'cache/qa_sub_tr.srt'), 'utf8'), style: 'kutulu' }, watermark: { file: path.join(root, 'assets/icon.png'), position: 'sag-ust', size: 12 }, titleText: 'Başlangıç {\\pos(0,0)}', titleSeconds: 5 });
  assert.ok(branded.ok, branded.error); checks.push('Subtitle, logo sizing and title render together');
  const brandedProof=await invoke('output-proof',{opts:{...base,subtitle:{source:'edited',srt:fs.readFileSync(path.join(userData,'cache/qa_sub_tr.srt'),'utf8'),style:'kutulu'},watermark:{file:path.join(root,'assets/icon.png'),position:'sag-ust',size:12},titleText:'Başlangıç {\\pos(0,0)}',titleSeconds:5},start:.5,format:'original'});
  assert.ok(brandedProof.url,brandedProof.error);
  const sampleFrame=(file,start)=>spawnSync(ffmpeg,['-ss',String(start),'-i',file,'-vf','scale=64:36','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true}).stdout;
  const expected=sampleFrame(branded.files[0],.5),actual=sampleFrame(require('url').fileURLToPath(brandedProof.url),0);
  assert.equal(actual.length,expected.length);assert.ok(actual.length>0);
  const difference=actual.reduce((sum,n,i)=>sum+Math.abs(n-expected[i]),0)/actual.length;assert.ok(difference<8,`Proof pixel difference: ${difference}`);
  await invoke('output-proof-cleanup',brandedProof.id);checks.push('Proof pixels agree with subtitle, logo and title in actual full export');
  ff(['-i', branded.files[0], '-frames:v', '1', path.join(out, 'branded.png')]);
  const packageOptions = {enabled:true,title:'Yayın başlığı',description:'Türkçe açıklama',coverTime:.2,srt:true};
  const packageSub = {source:'edited',style:'klasik',srt:'1\n00:00:00,000 --> 00:00:00,500\nİlk\n\n2\n00:00:01,000 --> 00:00:01,500\nİkinci\n'};
  const packaged = await invoke('download',{...base,title:'Paket testi',subtitle:packageSub,sequence:[{start:1,end:1.5},{start:0,end:.5}],publishPackage:packageOptions,publishLayouts:{original:{bottom:40,side:20}}});
  assert.ok(packaged.ok,packaged.error);
  const sidecar = fs.readFileSync(packaged.files.find(f=>f.endsWith('.srt')),'utf8');
  assert.ok(sidecar.indexOf('İkinci')<sidecar.indexOf('İlk')); assert.match(sidecar,/00:00:00,500 --> 00:00:01,000/);
  checks.push('Publication SRT follows reordered output rather than source time');
  const cover = spawnSync(ffmpeg,['-i',packaged.files.find(f=>f.endsWith('.jpg')),'-vf','scale=64:36','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true}).stdout, videoFrame = sampleFrame(packaged.files[0],.2);
  assert.equal(cover.length,videoFrame.length); assert.ok(cover.length>0); assert.ok(cover.reduce((sum,n,i)=>sum+Math.abs(n-videoFrame[i]),0)/cover.length<12);
  assert.match(fs.readFileSync(packaged.files.find(f=>f.endsWith('.txt')),'utf8'),/Türkçe açıklama/);
  checks.push('Publication cover matches the rendered output and metadata is UTF-8');
  const lowLayout = await invoke('download',{...base,title:'Yerleşim karşılaştırma',subtitle:packageSub,sequence:[{start:1,end:1.5},{start:0,end:.5}],publishLayouts:{original:{bottom:5,side:20}}});
  assert.ok(lowLayout.ok,lowLayout.error); const lowFrame=sampleFrame(lowLayout.files[0],.2);
  assert.ok(videoFrame.reduce((sum,n,i)=>sum+Math.abs(n-lowFrame[i]),0)/videoFrame.length>.2);
  checks.push('Format-specific subtitle placement changes the actual rendered frame');

  const invalidPack=await invoke('download',{...base,publishPackage:{...packageOptions,coverTime:10}}); assert.equal(invalidPack.ok,false); assert.match(invalidPack.error,/Kapak/);
  const missingSub=await invoke('download',{...base,publishPackage:packageOptions}); assert.equal(missingSub.ok,false); assert.match(missingSub.error,/SRT/);
  checks.push('Invalid cover time and missing approved subtitles stop publication early');
  const Package=require('../publish-package'); const beforeDirs=fs.readdirSync(out).filter(n=>n.startsWith('Yayin-paketi-'));
  await assert.rejects(Package.create({options:packageOptions,files:[packaged.files[0]],subtitle:packageSub,ffmpeg,run:async()=>({code:1}),cancelled:()=>false}),/Kapak/);
  assert.deepEqual(fs.readdirSync(out).filter(n=>n.startsWith('Yayin-paketi-')),beforeDirs); assert.ok(fs.existsSync(packaged.files[0]));
  checks.push('Failed publication removes only its own sidecars and preserves video');
  await assert.rejects(Package.create({options:packageOptions,files:[packaged.files[0]],subtitle:packageSub,ffmpeg,run:async()=>{throw Error('must not run');},cancelled:()=>true}),/iptal/);
  assert.deepEqual(fs.readdirSync(out).filter(n=>n.startsWith('Yayin-paketi-')),beforeDirs);
  checks.push('Publication cancellation cleans sidecars without deleting exported video');
  const assDir = path.join(out, 'ass'); fs.mkdirSync(assDir, { recursive: true });
  context.titleAss(assDir, 'A{\\pos(0,0)}B', { w: 640, h: 360 }, 10);
  const ass = fs.readFileSync(path.join(assDir, 'title.ass'), 'utf8');
  assert.match(ass, /0:00:10.00/); assert.ok(!ass.includes('{\\pos'));
  checks.push('Title timing and ASS escape are safe');
  fs.writeFileSync(path.join(userData, 'cache/qa_sub_tr.srt'), '');
  const empty = await invoke('download', { ...base, subtitle: { source: 'edited', srt: '', style: 'klasik' } });
  assert.equal(empty.ok, false); assert.match(empty.error, /altyazı bulunamadı/);
  checks.push('Empty subtitles stop export instead of disappearing silently');
  const logo = await invoke('download', { ...base, watermark: { file: path.join(out, 'missing.png') } });
  assert.equal(logo.ok, false); checks.push('Missing logo stops export');
  const missing = await invoke('download', { ...base, formats: ['vertical'], track: true });
  assert.equal(missing.ok, false); assert.match(missing.error, /kişi bulunamadı/);
  checks.push('Real detector reports no person in non-face video');
  const preview = await invoke('track-preview', { localFile: source, start: 0, duration: 2, trackMotion: 'calm' });
  assert.equal(preview.coverage, 0); assert.ok(preview.cropW <= 1); await invoke('track-preview-cleanup');
  checks.push('Real tracking preview returns missing-person coverage');
  const portrait = path.join(out, 'portrait.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x480:rate=10', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', portrait]);
  const silentSequence = await invoke('download', { ...base, localFile: portrait, duration: 1, title: 'Sessiz kurgu', sequence: [{start:.5,end:1},{start:0,end:.5}] });
  assert.ok(silentSequence.ok, silentSequence.error); checks.push('Timeline accepts a video source without an audio stream');
  const narrow = await invoke('download', { ...base, localFile: portrait, title: 'Dar portre', duration: 1, formats: ['vertical'], track: true, trackPoint: { x: .5, y: .5 }, trackMotion: 'responsive' });
  assert.ok(narrow.ok, narrow.error); checks.push('Narrow portrait renders tracking without out-of-bounds crop');
  const reviewSrt = '1\n00:00:00,000 --> 00:00:01,500\nKontrol edilmiş metin\n';
  fs.writeFileSync(path.join(userData, 'cache/qa_sub_tr.srt'), reviewSrt);
  const review = await invoke('subtitle-review', { source: 'youtube', videoId: 'qa', lang: 'tr', start: 0, duration: 2 });
  assert.ok(review.srt.includes('Kontrol edilmiş'), review.error); checks.push('Prepare transcript returns editable clip-relative text');
  fs.writeFileSync(path.join(userData, 'cache/qa_sub_whisper_small_0_2.srt'), reviewSrt);
  fs.writeFileSync(path.join(userData,'cache/qa_sub_whisperwords_small_0_2.json'),JSON.stringify({words:[{word:'Kontrol',start:.1,end:.3},{word:'edilmiş',start:.5,end:.9},{word:'metin',start:1.1,end:1.4}]}));
  const whisperReview = await invoke('subtitle-review', { source: 'whisper', videoId: 'qa', localFile: source, model: 'small', start: 0, duration: 2 });
  assert.ok(whisperReview.srt.includes('Kontrol edilmiş'), whisperReview.error); checks.push('Whisper review reuses cached transcription before export');
  assert.equal(whisperReview.words[0].start,.1);assert.equal(whisperReview.words[1].start,.5);assert.ok(!whisperReview.words[0].estimated);checks.push('Whisper review returns acoustic word times instead of estimating them');
  const manual = await invoke('track-preview', { localFile: source, start: 0, duration: 2, tracking: false });
  assert.ok(manual.path.length === 1, manual.error); await invoke('track-preview-cleanup'); checks.push('Subtitle review works without person detection');
  const edited = await invoke('download', { ...base, title: 'Onaylı kurgu', formats: ['vertical'], framingPath: [{ t: 0, x: 0 }, { t: 1, x: .65 }], subtitle: { source: 'edited', srt: reviewSrt, style: 'kutulu', bottom: 26, side: 18 } });
  assert.ok(edited.ok, edited.error); ff(['-i', edited.files[0], '-frames:v', '1', path.join(out, 'reviewed.png')]); checks.push('Approved subtitles and saved camera path render without regeneration');
  const animated = await invoke('download', { ...base, title: 'Onaylı animasyon', subtitle: { source: 'edited', srt: reviewSrt, style: 'vurgulu', bottom: 26, side: 18 } });
  assert.ok(animated.ok, animated.error); checks.push('Edited text also renders in animated style');
  const unreviewed = await invoke('download', { ...base, subtitle: { source: 'whisper', model: 'small' } });
  assert.equal(unreviewed.ok, false); assert.match(unreviewed.error, /onaylayın/); checks.push('Export rejects unreviewed legacy queue subtitles');
  const boundaryText = '1\n00:00:00,000 --> 00:00:02,000\nbir iki üç dört beş altı yedi sekiz\n';
  for (const style of ['vurgulu', 'pop']) {
    context.karaokeAss(assDir, context.subtitleWords(boundaryText), style, {w:1080,h:1920}, 70, `boundary-${style}.ass`, 18);
    const content = fs.readFileSync(path.join(assDir, `boundary-${style}.ass`), 'utf8');
    const events = content.split('\n').filter(line => line.startsWith('Dialogue:')).map(line => line.split(','));
    const seconds = t => t.split(':').reduce((value, part) => value * 60 + +part, 0);
    events.forEach((event, i) => { assert.ok(seconds(event[2]) > seconds(event[1])); if (i) assert.ok(seconds(events[i-1][2]) <= seconds(event[1])); });
    assert.ok(!/[\x0c\r]/.test(events.map(e=>e.join(',')).join('')));
    if (style === 'pop') assert.ok(content.includes('\\fscx55'));
    else { assert.ok(content.includes('\\1c&H00E5FF&')); assert.ok(!content.includes('fscx112')); }
    const rendered = await invoke('download', {...base, title:`Geçiş-${style}`, formats:['vertical'], subtitle:{source:'edited',srt:boundaryText,style,bottom:26,side:18}});
    assert.ok(rendered.ok, rendered.error);
    ff(['-ss', '0.98', '-i', rendered.files[0], '-frames:v', '1', path.join(out, `transition-${style}.png`)]);
    checks.push(`${style}: actual ASS intervals do not overlap and transition video renders`);
  }
  const invalidText = await invoke('download', { ...base, subtitle: { source: 'edited', srt: reviewSrt.replace('01,500', '09,500') } });
  assert.equal(invalidText.ok, false); checks.push('Backend rejects transcript beyond clip duration');
  const invalidPath = await invoke('download', { ...base, framingPath: [{ t: 0, x: -1 }] });
  assert.equal(invalidPath.ok, false); checks.push('Backend rejects invalid framing path');
  const config = await invoke('provider-settings-save', {geminiKey:'fake-test-key',geminiModelChain:'gemini-3.8-flash,gemini-3.6-flash',geminiTtsChain:'gemini-3.8-flash-tts'});
  assert.ok(config.ok, config.error);
  let apiCalls=0;
  context.fetch=async (url,options)=>{
    assert.equal(options.headers['x-goog-api-key'],'fake-test-key');
    assert.ok(!JSON.parse(options.body).generationConfig.temperature);
    return new Response(JSON.stringify(++apiCalls===1?{error:{code:404}}:{candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]}),{status:apiCalls===1?404:200});
  };
  const chainResult=await context.generateText('test',.2,()=>{},()=>false);
  assert.ok(chainResult.data.ok);assert.equal(chainResult.model,'gemini-3.6-flash');checks.push('Production Gemini wrapper routes through saved chain and omits obsolete sampling parameters');
  const publicConfig = await invoke('get-settings'); assert.ok(publicConfig.geminiKey.startsWith('stored:')); assert.ok(!JSON.stringify(publicConfig).includes('fake-test-key')); assert.ok(!JSON.stringify(config).includes('fake-test-key')); assert.ok(!fs.readFileSync(path.join(userData,'settings.json'),'utf8').includes('fake-test-key'));
  checks.push('Settings IPC and disk storage do not expose plaintext credentials');
  const invalidConfig=await invoke('provider-settings-save',{geminiModelChain:'gemini-3.8-flash-tts'});assert.ok(invalidConfig.error);checks.push('Settings backend rejects audio models in the text chain');
  for(const [format,mime] of [['wav','audio/wav'],['s16le','audio/L16;codec=pcm;rate=24000']]){
    const fixture=path.join(out,`tts-${format}.audio`);
    ff(['-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t','0.3','-f',format,fixture]);
    const audio=fs.readFileSync(fixture).toString('base64');
    context.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:mime,data:audio}}]}}]}),{status:200});
    const ttsResult=await context.generateTts('test','Kore',path.join(out,`tts-${format}.mp3`),out);
    assert.ok(ttsResult.ok,ttsResult.error);checks.push(`Gemini TTS ${format} response converts to real MP3`);
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ checks }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
