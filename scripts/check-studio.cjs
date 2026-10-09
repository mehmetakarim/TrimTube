// Run with Electron: electron scripts/check-studio.cjs
// Generates its own media fixture. No external API calls or user settings writes.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build/studio-qa');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'profile'));
app.disableHardwareAcceleration();
const source = path.join(out, 'source.mp4');
const ffmpeg = require('ffmpeg-static');
if (!fs.existsSync(source)) {
  const fixture = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*440*t)*(0.15+0.85*pow(sin(2*PI*0.7*t),2))':s=16000", '-t', '90', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-c:a', 'aac', source], { windowsHide: true });
  if (fixture.status) throw Error(fixture.stderr.toString());
}
const fixtureImage = (name, filter) => {
  const file = path.join(out, name);
  const result = spawnSync(ffmpeg, ['-y', '-i', source, '-filter_complex', filter, '-frames:v', '1', file], { windowsHide: true });
  if (result.status) throw Error(result.stderr.toString());
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
};
const wave = fixtureImage('wave.png', 'aformat=channel_layouts=mono,showwavespic=s=900x92:colors=0A84FF:scale=sqrt');
const strip = fixtureImage('strip.png', 'fps=1/8,scale=80:45,tile=12x1');
const settings = { theme: 'dark', sidebarOpen: false, defaultQuality: 'best', defaultFormats: ['original'], appVersion: '1.18.1' };
const proofSource=path.join(out,'proof-source.mp4');
const proofFixture=spawnSync(ffmpeg,['-y','-i',source,'-t','5','-c','copy',proofSource],{windowsHide:true});
if(proofFixture.status) throw Error(proofFixture.stderr.toString());
const calls = [];
let customThemes = [];
let retryCount = 0;
let lastDraft = null;
for (const [, channel] of fs.readFileSync(path.join(root, 'preload.js'), 'utf8').matchAll(/invoke\('([^']+)'/g)) {
  ipcMain.handle(channel, async (_event, data) => {
    calls.push({ channel, data });
    if (channel === 'get-settings') return settings;
    if (channel === 'project-draft-save') { lastDraft = { app: 'trimtube', version: 2, project: data }; return { ok: true }; }
    if (channel === 'project-draft-read') return { ok: true, draft: lastDraft };
    if (channel === 'set-settings') return Object.assign(settings, data);
    if (channel === 'provider-settings-save') { if (Object.values(data).includes('reject-test')) return {error:'Test: yazma izni yok'}; for (const [k,v] of Object.entries(data)) settings[k]=['geminiKey','elevenKey','pexelsKey'].includes(k)?(v?'stored':''):v; return {ok:true,settings}; }
    if (channel === 'provider-history') return [];
    if (channel === 'provider-test') { await new Promise(resolve=>setTimeout(resolve,100)); return {ok:true,message:'Listeye erişildi; üretim garantisi değildir.',models:['gemini-3.8-flash'],ttsModels:['gemini-3.8-flash-tts'],textChain:['gemini-3.8-flash'],ttsChain:['gemini-3.8-flash-tts']}; }
    if (channel === 'get-default-folder') return out;
    if (channel === 'filmstrip') return strip;
    if (channel === 'waveform') return wave;
    if (channel === 'cache-info') return { videos: 0, bytes: 0 };
    if (channel === 'ytdlp-info') return { version: 'test' };
    if (channel === 'mood-voices') return { voices: [] };
    if (channel === 'vv-choose-music') return { ok: true, music: { path: 'C:/qa/fon.mp3', name: 'fon.mp3', duration: 30 } };
    if (channel === 'vv-choose-media') return { ok: true, media: { source: 'local', kind: 'image', path: 'C:/qa/urun.png', thumb: 'data:image/jpeg;base64,/9j/' } };
    if (channel === 'vv-themes') return { builtIn: require(path.join(root, 'renderer/voice-themes.js')).BUILT_IN, custom: customThemes };
    if (channel === 'vv-theme-save') { const t = { ...data, id: data.id || 'custom-qa1' }; customThemes = customThemes.filter(x => x.id !== t.id).concat(t); return { ok: true, theme: t }; }
    if (channel === 'vv-theme-delete') { customThemes = customThemes.filter(x => x.id !== data); return { ok: true }; }
    if (channel === 'vv-theme-from-prompt') { await new Promise(resolve => setTimeout(resolve, 60)); return { ok: true, theme: { name: 'Analog Kolaj', description: 'Sarı vurgulu kâğıt kolaj', colors: { bg: '#f4efe4', bg2: '#e9e1cf', ink: '#1d1d1b', muted: '#4a4741', card: '#ffffff', accents: ['#f9b233', '#1d1d1b'] }, fonts: { display: 'Archivo Black', body: 'Inter', label: 'Permanent Marker' }, type: { weight: 900, case: 'upper', tracking: -2 }, background: 'paper', card: 'paper', frame: 'tape', radius: 6, motifs: ['tape', 'arrows', 'torn', 'halftone'], energy: 'punchy', transition: 'slide', emphasis: ['box', 'circle'], label: 'KARŞILAŞTIRMA' } }; }
    if (channel === 'vv-theme-export') return { ok: true, count: data ? data.length : customThemes.length, file: 'C:/qa/temalar.trimtube-theme' };
    if (channel === 'vv-theme-import') { const t = { ...customThemes[0], id: 'custom-qa2', name: 'İçe aktarılan' }; customThemes = customThemes.concat(t); return { ok: true, added: [{ id: t.id, name: t.name }], skipped: [] }; }
    if (channel === 'vv-cutout') { await new Promise(resolve => setTimeout(resolve, 60)); return data?.kind === 'image' ? { ok: true, thumb: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } : { error: 'Arka plan yalnız görsellerden kaldırılabilir.' }; }
    if (channel === 'vv-source') return { ok: true, title: 'Sayfa', text: 'Okunan sayfa metni '.repeat(30), url: data.url };
    if (channel === 'vv-script') { await new Promise(resolve => setTimeout(resolve, 80)); return { ok: true, model: 'gemini-3.8-flash', script: { title: 'Test anlatımı', scenes: [
      { id: 'qa-s1', narration: '[excited] Selam! [laughs] Bugün harika bir konu var.', visual: { type: 'title', heading: 'Harika konu', subheading: '', value: '', label: '', source: '', quote: '', author: '', button: '', items: [] }, keywords: 'city' },
      { id: 'qa-s2', narration: '[empathetic] Biliyorum, zor. [normal] Ama çözüm basit.', visual: { type: 'stat', heading: '', subheading: '', value: '%45', label: 'oran', source: '', quote: '', author: '', button: '', items: [] }, keywords: 'office' }] } }; }
    if (channel === 'vv-produce') { await new Promise(resolve => setTimeout(resolve, 120)); return { ok: true, outFile: source, duration: 9.5, rendered: data.scenes.length, credits: 0, warnings: [],
      scenes: [{ id: 'qa-s1', start: 0, end: 4, speech: 3.6 }, { id: 'qa-s2', start: 4, end: 9.5, speech: 4.3 }],
      cues: [{ start: .05, end: 2, text: 'Selam!' }, { start: 2, end: 3.6, text: 'Bugün harika bir konu var.' }, { start: 4.05, end: 8, text: 'Biliyorum, zor. Ama çözüm basit.' }] }; }
    if (channel === 'subtitle-review') { await new Promise(resolve => setTimeout(resolve, 100)); return { srt: '1\n00:00:00,000 --> 00:00:02,000\nDeneme altyazısı\n\n2\n00:00:03,000 --> 00:00:05,000\nİkinci satır\n',words:[{word:'Deneme',start:.2,end:.8},{word:'altyazısı',start:1.1,end:1.8},{word:'İkinci',start:3.2,end:3.8},{word:'satır',start:4.1,end:4.8}] }; }
    if (channel === 'output-proof') {await new Promise(resolve=>setTimeout(resolve,150));return {id:'qa-proof',url:pathToFileURL(proofSource).href,duration:5};}
    if (channel === 'download') return data.title === 'qa-retry' && retryCount++ === 0 ? { ok: false, error: 'Geçici test hatası' } : { ok: true };
    if (channel === 'local-info') return { id: 'qa', title: 'Yerel test', duration: 90, size: 2048000, width: 640, height: 360, localFile: source, previewUrl: pathToFileURL(source).href };
    if (channel === 'track-preview') {
      await new Promise(resolve => setTimeout(resolve, 180));
      return { path: [{ t: 0, x: .2 }], cropW: .316, sourceAspect: 16 / 9, coverage: 70, boxes: [{ t: 0, x: .3, y: .2, w: .2, h: .5 }], clipUrl: pathToFileURL(source).href };
    }
    return null;
  });
}
const errors = [];
const checks = [];
let win;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(code) { return win.webContents.executeJavaScript(code); }
async function check(label, expression) {
  if (!await run(expression)) throw Error(label);
  checks.push(label);
}
async function screenshot(name) {
  await delay(200);
  fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true } });
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  await win.loadFile(path.join(root, 'renderer/index.html'));
  await delay(250);
  await check('Empty state and disabled actions', `$('studioOpenFile') && $('loopSelection').disabled && $('downloadBtn').disabled`);
  await screenshot('empty-dark');
  await run(`populateFromInfo(${JSON.stringify({ id: 'qa', title: 'Kurgu denemesi · Görüntü ve ses', duration: 90, previewUrl: pathToFileURL(source).href, localFile: source })})`);
  await delay(700);
  await check('Trimming off still permits timeline navigation', `!$('trimControls').classList.contains('disabled') && $('rangeStart').disabled`);
  const rect = await run(`(() => { $('videoTimeline').scrollIntoView({block:'center'}); const r = $('videoTimeline').getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}; })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect });
  await delay(150);
  await check('Pointer scrub seeks to the clicked timestamp', `Math.abs($('preview').currentTime - 45) < 1`);
  await run(`$('preview').currentTime = 0`);
  await run(`document.querySelector('[data-seconds="30"]').click()`);
  await delay(650);
  await check('30-second preset enables trimming', `$('trimEnable').checked && +$('rangeEnd').value - +$('rangeStart').value === 30`);
  await check('Real waveform and filmstrip are visible', `!$('waveform').classList.contains('hidden') && !$('filmstripBand').classList.contains('hidden')`);
  await run(`$('zoomIn').click()`);
  await check('Zoom narrows audio viewport', `zoomWin.end - zoomWin.start < 45`);
  await run(`$('timelinePan').value = 50; $('timelinePan').dispatchEvent(new Event('input'))`);
  await check('Panning preserves selection', `zoomWin.start === 50 && +$('rangeStart').value === 0 && +$('rangeEnd').value === 30`);
  await run(`$('zoomFit').click(); $('rangeStartFine').value = 5; $('rangeStartFine').dispatchEvent(new Event('input'))`);
  await check('Fine adjustment updates export options', `+$('rangeStart').value === 5 && buildOpts().opts.trim.start === '00:00:05'`);
  await run(`$('rangeStartFine').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await delay(80);
  await check('Keyboard adjusts the trim handle', `+$('rangeStart').value === 6`);
  await run(`$('rangeStartFine').value = 5; $('rangeStartFine').dispatchEvent(new Event('input')); $('rangeStartFine').blur()`);
  await run(`$('loopSelection').click()`);
  await delay(150);
  await check('Loop preview plays', `$('loopSelection').getAttribute('aria-pressed') === 'true' && !$('preview').paused`);
  await run(`$('preview').currentTime = 31; $('preview').dispatchEvent(new Event('timeupdate'))`);
  await check('Loop returns to in point', `$('preview').currentTime < 6`);
  await run(`$('preview').pause(); $('loopSelection').click(); $('preview').currentTime = 12`);
  await delay(650);
  await screenshot('loaded-dark');
  await run(`applyTheme('light')`);
  await screenshot('loaded-light');
  win.setSize(900, 640);
  await delay(250);
  await screenshot('compact-light');
  await check('Compact timeline stays within stage width', `$('trimControls').getBoundingClientRect().right <= document.querySelector('.stage').getBoundingClientRect().right`);
  await check('No horizontal document overflow', `document.documentElement.scrollWidth <= innerWidth`);
  await run(`$('navToggle').click()`);
  await screenshot('compact-menu');
  await check('Expanded menu does not overflow timeline', `document.querySelector('.timeline-shell').scrollWidth <= document.querySelector('.timeline-shell').clientWidth`);
  await check('Compact timeline fits vertically', `document.querySelector('.stage').scrollHeight <= document.querySelector('.stage').clientHeight + 1`);
  for (const view of ['ai', 'mood', 'smarttrim', 'broll', 'voice', 'compress', 'settings', 'cutter']) {
    await run(`switchView('${view}')`);
    await check(`Navigate ${view}`, `!$(VIEWS['${view}']).classList.contains('hidden')`);
  }
  win.setSize(1280, 900);
  await run(`$('sideNav').classList.add('collapsed'); applyTheme('dark'); $('toolTab-frame').click(); $('trackEnable').click()`);
  await check('Tracking discovers and enables vertical output', `selectedFormats.has('vertical') && $('trackEnable').checked && !$('trackTuning').classList.contains('hidden')`);
  await run(`$('selectPersonBtn').click()`);
  await delay(300);
  await run(`(() => { const r = $('preview').getBoundingClientRect(); window.editorPickPerson({clientX:r.left + 1,clientY:r.top + r.height/2,preventDefault(){}}); })()`);
  await check('Letterbox clicks are rejected', `trackPoint === null && $('personStatus').textContent.includes('Siyah')`);
  await run(`(() => { const r = $('preview').getBoundingClientRect(); window.editorPickPerson({clientX:r.left+r.width/2,clientY:r.top+r.height/2,preventDefault(){}}); })()`);
  await check('Selection uses image coordinates and starting time', `Math.abs(trackPoint.x-.5)<.01 && Math.abs(trackPoint.y-.5)<.01 && trackPoint.at === 5`);
  await check('Expanded tracking controls do not overlap output quality', `document.querySelector('.editor-tool-area').getBoundingClientRect().bottom <= $('quality').closest('.field').getBoundingClientRect().top`);
  await run(`$('trackPreviewBtn').scrollIntoView({block:'nearest'})`);
  await screenshot('tools-tracking');
  await run(`$('rangeStart').value=6; $('rangeStart').dispatchEvent(new Event('input')); computeZoomWindow()`);
  await check('Changing the in point clears person selection', `trackPoint === null`);
  await run(`computeTrackPreview(); invalidateTrackPreview()`);
  await delay(250);
  await check('Cancelled stale preview cannot reopen modal', `$('trackPreviewModal').classList.contains('hidden') && !tp.generating`);
  await run(`computeTrackPreview()`);
  await delay(250);
  await check('Preview reports tracking coverage', `!$('trackPreviewModal').classList.contains('hidden') && $('tpAssessment').textContent.includes('%70')`);
  await screenshot('tracking-preview');
  await run(`closeTrackModal(); $('toolTab-subtitle').click(); subAllLangs={manual:['en'],auto:['tr','en']}; subPick=pickSubtitle({autoLangs:['en','tr']}); window.editorSubtitleSources(); $('subEnable').click()`);
  await check('Turkish automatic subtitle gets preferred', `subPick.lang==='tr' && $('subtitleSource').value==='auto:tr'`);
  await run(`$('subtitleSource').value='whisper'; $('subtitleSource').dispatchEvent(new Event('change')); document.querySelector('[data-substyle="vurgulu"]').click(); $('trackMotion').value='calm'`);
  await check('Subtitle source and animated sample update together', `buildOpts().error.includes('Altyazı') && subPick.source==='whisper' && $('subtitleSample').dataset.style==='vurgulu' && !$('subModels').classList.contains('hidden')`);
  await screenshot('tools-subtitles');
  await run(`$('reviewGenerate').click(); $('reviewGenerate').click()`); await delay(180);
  await check('Cancelled transcription cannot publish a late result', `!tp.open && !window.reviewProject().doc && buildOpts().error.includes('Altyazı')`);
  await run(`$('reviewGenerate').click()`);
  await delay(650);
  await check('Generated subtitles open for review before export', `tp.open && $('reviewCues').children.length===2 && buildOpts().error.includes('Altyazı')`);
  await check('Measured word timings are retained in the editable document', `reviewProject().doc.words[0].start===.2 && ReviewData.alignedWords(reviewProject().doc.cues,reviewProject().doc.words)[1].start===1.1`);
  await run(`$('preview').pause(); $('tpVideo').pause(); globalThis.keyboardBefore={main:$('preview').currentTime,review:$('tpVideo').currentTime}; const keyboardArea=$('reviewCues').querySelector('textarea'); keyboardArea.value='biriki'; keyboardArea.focus(); keyboardArea.setSelectionRange(3,3)`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});
  win.webContents.sendInputEvent({type:'char',keyCode:' '});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await delay(100);
  await check('Space inserts a subtitle space without toggling either video', `$('reviewCues').querySelector('textarea').value==='bir iki' && $('preview').paused && $('tpVideo').paused`);
  await run(`for(const key of ['j','k','l','i','o','ArrowLeft','ArrowRight']) $('reviewCues').querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))`);
  await check('Subtitle typing and cursor keys never seek the underlying video', `$('preview').paused && $('tpVideo').paused && $('preview').currentTime===keyboardBefore.main && $('tpVideo').currentTime===keyboardBefore.review`);
  await run(`$('tpCanvas').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))`);
  await check('Modal background cannot trigger the main player shortcut', `$('preview').paused`);

  await run(`$('tpVideo').pause(); $('tpVideo').currentTime=0; const area=$('reviewCues').querySelector('textarea'); area.value='Düzeltilmiş Türkçe metin'; area.dispatchEvent(new Event('input',{bubbles:true})); $('reviewBottom').value=26; $('reviewBottom').dispatchEvent(new Event('input')); document.querySelector('[data-safezone="reels"]').click(); $('reviewPan').value=70; $('reviewPan').dispatchEvent(new Event('input')); $('reviewSave').click()`);
  await check('Approved edited text and camera path reach export', `buildOpts().opts.subtitle.source==='edited' && buildOpts().opts.subtitle.srt.includes('Düzeltilmiş') && buildOpts().opts.subtitle.bottom===26 && Math.abs(buildOpts().opts.framingPath[0].x - .7*(1-tp.cropW))<.001`);
  await check('Manual camera correction resumes original framing after five seconds', `buildOpts().opts.framingPath.some(p=>p.t===5 && p.x===.2)`);
  await run(`$('reviewTabFrame').click()`); await screenshot('review-range-controls'); await run(`$('reviewTabText').click()`);
  await run(`window.reviewBackup=JSON.parse(JSON.stringify(reviewProject())); sessionCheckpoint(); $('reviewFind').value='Düzeltilmiş'; $('reviewReplace').value='Kontrol'; $('reviewReplaceAll').click()`);
  await check('Bulk subtitle replacement invalidates approval', `reviewProject().doc.cues[0].text.includes('Kontrol') && !reviewProject().doc.approved`);
  await run(`$('reviewUndo').click()`);
  await check('Review undo restores approved text', `reviewProject().doc.cues[0].text.includes('Düzeltilmiş') && reviewProject().doc.approved`);
  await run(`$('reviewCues').querySelector('textarea').setSelectionRange(5,5); $('reviewCues').querySelector('.review-cue-actions button').click()`);
  await check('Subtitle splits into two contiguous cue intervals', `reviewProject().doc.cues.length===3 && reviewProject().doc.cues[0].end===reviewProject().doc.cues[1].start`);
  await run(`$('reviewCues').querySelector('.review-cue-actions button:nth-child(2)').click()`);
  await check('Adjacent subtitle rows merge without overlap', `reviewProject().doc.cues.length===2 && reviewProject().doc.cues[0].end<=reviewProject().doc.cues[1].start`);
  await run(`reviewApplyProject(reviewBackup,true); reviewRefreshCues()`);
  await run(`$('reviewSelectAll').click()`);
  await check('Transcript selection preserves approval and reports duration', `reviewProject().doc.approved && document.querySelectorAll('[data-cut]:checked').length===2 && !$('reviewCutAdd').disabled`);
  await screenshot('text-to-edit');
  await run(`globalThis.cutExpected=reviewProject().doc.cues.map(c=>({start:currentRange().start+c.start,end:currentRange().start+c.end})); $('reviewCutAdd').click()`);
  await check('Selected text creates source-relative clips and closes review', `sequenceProject().clips.length===2 && sequenceProject().clips.every((c,i)=>c.start===cutExpected[i].start && c.end===cutExpected[i].end) && $('trackPreviewModal').classList.contains('hidden')`);
  await run(`$('editUndo').click()`);
  await check('Text batch is undone as one edit', `sequenceProject().clips.length===0`);
  await run(`$('editRedo').click()`);
  await check('Text batch redo restores both ranges', `sequenceProject().clips.length===2`);
  await run(`globalThis.beforeBad=JSON.stringify(sequenceProject()); try { sequenceAppendRanges([{start:0,end:9999}]); } catch {} `);
  await check('Invalid batch leaves the existing edit untouched', `JSON.stringify(sequenceProject())===beforeBad`);
  await run(`sequenceAppendRanges([{start:1,end:2}])`);
  await check('Text append preserves existing clips', `sequenceProject().clips.length===3 && sequenceProject().clips[0].start===cutExpected[0].start && sequenceProject().clips[2].start===1`);
  await run(`$('editUndo').click(); $('editUndo').click(); computeTrackPreview()`); await delay(350);
  await run(`$('reviewTabText').click(); $('reviewSelectAll').click(); $('reviewClearSelection').click()`);
  await check('Clear selection disables append without editing subtitles', `$('reviewCutAdd').disabled && !document.querySelector('[data-cut]:checked') && reviewProject().doc.approved`);

  await delay(100);
  await check('Subtitle shown over output with platform safety check', `$('reviewCaption').textContent.includes('Düzeltilmiş') && $('reviewSafety').textContent.includes('taşmıyor')`);
  await screenshot('review-desk');
  await check('Highlighted style shows the active word in yellow', `$('reviewCaption').dataset.style==='vurgulu' && $('reviewCaption').querySelector('.review-word-active')?.textContent==='Düzeltilmiş' && getComputedStyle($('reviewCaption').querySelector('.review-word-active')).color==='rgb(255, 229, 0)'`);
  await run(`$('tpVideo').currentTime=1.2`); await delay(100);
  await check('Highlight follows shared word timing while scrubbing', `$('reviewCaption').querySelector('.review-word-active')?.textContent==='Türkçe'`);
  await screenshot('review-highlight');
  for (const style of ['klasik','kutulu','dolgun','pop','vurgulu']) {
    await run(`$('reviewStyle').value='${style}'; $('reviewStyle').dispatchEvent(new Event('change')); $('tpVideo').currentTime=.2`); await delay(80);
    await check(`Review style ${style} updates preview and export`, `subStyleValue==='${style}' && $('reviewCaption').dataset.style==='${style}' && buildOpts().opts.subtitle.style==='${style}'`);
    if (style==='pop') { await check('Pop preview displays a single animated word', `$('reviewCaption').children.length===1 && $('reviewCaption').textContent==='Düzeltilmiş' && $('reviewCaption').style.transform.startsWith('scale(')`); await screenshot('review-pop'); }
    if (style==='kutulu') await check('Boxed preview has a background', `getComputedStyle($('reviewCaption')).backgroundColor!=='rgba(0, 0, 0, 0)'`);
  }
  await run(`$('tpVideo').currentTime=0`);

  await run(`$('reviewCues').querySelector('[data-end]').value=99; $('reviewCues').querySelector('[data-end]').dispatchEvent(new Event('input',{bubbles:true})); $('reviewSave').click()`);
  await check('Out of range transcript cannot be approved', `buildOpts().error && $('reviewSaveStatus').textContent.includes('zaman')`);
  await run(`globalThis.draftProject=buildProject(); window.reviewApplyProject(draftProject.review,true)`);
  await check('Unfinished transcript survives project restore without approval', `window.reviewProject().doc.cues[0].end===99 && !window.reviewProject().doc.approved`);
  await run(`$('reviewCues').querySelector('[data-end]').value=2; $('reviewCues').querySelector('[data-end]').dispatchEvent(new Event('input',{bubbles:true})); $('reviewSave').click(); globalThis.reviewSaved=buildProject(); applyProjectSettings(reviewSaved,true)`);
  await check('Project round trip preserves approved text and framing', `buildOpts().opts.subtitle.srt.includes('Düzeltilmiş') && buildOpts().opts.framingPath.length>0`);
  await run(`$('rangeStart').value=7; $('rangeStart').dispatchEvent(new Event('input'))`);
  await check('Changed range invalidates subtitle approval', `buildOpts().error.includes('Altyazı')`);
  await run(`applyProjectSettings(reviewSaved,true); computeTrackPreview()`); await delay(300);
  win.setSize(900,640); await delay(100);
  await check('Review desk fits compact window horizontally', `document.querySelector('.tp-modal').scrollWidth <= document.querySelector('.tp-modal').clientWidth`);
  await screenshot('review-compact'); win.setSize(1280,900);
  await run(`closeTrackModal()`);

  await run(`$('toolTab-brand').click(); $('wmEnable').click()`);
  await check('No silent missing watermark', `buildOpts().error.includes('Logo')`);
  await run(`watermarkFile=${JSON.stringify(path.join(root, 'assets/icon.png'))}; $('wmFile').textContent='icon.png'; $('wmSize').value=14; $('titleEnable').click()`);
  await check('No silent empty title', `buildOpts().error.includes('Başlık')`);
  await run(`$('titleText').value='Hikâyenin başladığı an'; $('titleSeconds').value='10'; window.editorRefresh()`);
  await check('Brand settings reach export', `buildOpts().opts.watermark.size===14 && buildOpts().opts.titleSeconds===10`);
  await screenshot('tools-brand');
  await run(`globalThis.savedProject=buildProject(); $('wmSize').value=4; $('trackMotion').value='responsive'; applyProjectSettings(savedProject,true)`);
  await check('Project restores new tool settings', `$('wmSize').value==='14' && $('trackMotion').value==='calm' && subPick.source==='whisper' && $('titleSeconds').value==='10'`);
  await run(`selectedFormats.clear(); selectedFormats.add('gif'); refreshFormatButtons(); window.editorRefresh()`);
  await check('GIF-only skips unsupported visual extras', `buildOpts().opts.subtitle===null && buildOpts().opts.watermark===null && buildOpts().opts.titleText===null`);
  await run(`applyProjectSettings(savedProject,true); $('quality').value='audio'; $('quality').dispatchEvent(new Event('change'))`);
  await check('Audio mode hides all subtitle sub-controls', `$('subModels').classList.contains('hidden') && $('subAnimHint').classList.contains('hidden') && buildOpts().opts.subtitle===null`);
  await run(`$('quality').value='best'; $('quality').dispatchEvent(new Event('change'))`);
  await run(`switchView('mood')`);
  await check('Missing Gemini key prevents expensive planning', `$('mdPlanBtn').disabled`);
  for (const view of ['compress','smarttrim','ai','mood','broll','settings']) {
    await run(`switchView('${view}')`);
    await screenshot(`workspace-${view}`);
    await check(`Workspace ${view} has no horizontal overflow`, `document.documentElement.scrollWidth <= innerWidth && $(VIEWS['${view}']).scrollWidth <= $(VIEWS['${view}']).clientWidth`);
  }
  await run(`switchView('compress'); $('cmpReuseSource').click()`);
  await delay(50);
  await check('Reuse loaded source in compression', `cmpFile === currentLocalFile && !$('cmpFileCard').classList.contains('hidden')`);
  await screenshot('workspace-compress-loaded');
  for (const view of ['smarttrim','mood','broll','settings']) {
    win.setSize(900,640);
    await run(`applyTheme('light'); switchView('${view}')`);
    await delay(80);
    await check(`Compact ${view} has no horizontal overflow`, `document.documentElement.scrollWidth <= innerWidth && $(VIEWS['${view}']).scrollWidth <= $(VIEWS['${view}']).clientWidth`);
    await screenshot(`compact-${view}`);
  }
  await run(`switchView('cutter'); applyProjectSettings(savedProject,true); computeTrackPreview()`); await delay(350);
  await run(`$('reviewExport').click()`); await delay(200);
  const exported = calls.filter(c => c.channel === 'download').at(-1)?.data;
  if (!exported?.subtitle?.srt.includes('Düzeltilmiş') || !exported.framingPath?.length) throw Error('Review export did not send approved state');
  checks.push('Apply and export sends approved text and saved framing through the queue');
  await run(`switchView('settings'); $('setGeminiKey').value='qa-key'; $('setGeminiKey').dispatchEvent(new Event('input')); $('geminiKeyTestBtn').click()`); await delay(200);
  await check('Gemini settings separate discovery from generation guarantees', `$('geminiKeyStatus').textContent.includes('garantisi') && $('modelCatalog').options.length===2 && settings.geminiKey==='stored'`);
  await run(`$('modelCatalog').value='gemini-3.8-flash'; $('modelCatalogAdd').click(); $('modelChainSave').click()`); await delay(70);
  await check('Saved credentials are not retained in key inputs', `$('setGeminiKey').value==='' && settings.geminiKey==='stored'`);
  await check('Discovered model can be added to saved text chain', `settings.geminiModelChain==='gemini-3.8-flash' && $('geminiTtsChain').value===''`);
  await run(`$('geminiKeyTestBtn').click()`); await delay(20); await run(`$('setGeminiKey').value='new-qa-key'; $('setGeminiKey').dispatchEvent(new Event('input'))`); await delay(130);
  await check('Stale API check cannot validate an edited credential', `$('geminiKeyStatus').textContent==='Değişiklik kaydedilmedi' && $('modelCatalog').options.length===0`);
  await run(`$('setElevenKey').value='qa-eleven'; $('setElevenKey').dispatchEvent(new Event('input')); $('elevenKeyTestBtn').click(); $('setPexelsKey').value='qa-pexels'; $('setPexelsKey').dispatchEvent(new Event('input')); $('pexelsKeyTestBtn').click()`); await delay(200);
  await check('ElevenLabs and Pexels have independent tested status', `$('elevenKeyStatus').dataset.state==='ok' && $('pexelsKeyStatus').dataset.state==='ok'`);
  await run(`$('setGeminiKey').value='reject-test'; $('setGeminiKey').dispatchEvent(new Event('input')); $('geminiKeySaveBtn').click()`); await delay(80);
  await check('Failed key save is reported without changing saved key', `$('geminiKeyStatus').textContent.includes('yazma izni') && settings.geminiKey==='stored'`);
  await run(`$('setGeminiKey').value='qa-key'; $('setGeminiKey').dispatchEvent(new Event('input')); $('geminiKeyTestBtn').click(); $('toastClose').click()`); await delay(200);
  await run(`$('geminiKeySaveBtn').click()`); await delay(60);
  await check('Saving an untouched empty field preserves the stored key', `settings.geminiKey==='stored' && $('setGeminiKey').value===''`);
  await run(`$('geminiKeyRemoveBtn').click()`); await delay(60);
  await check('Explicit remove clears only the selected provider', `settings.geminiKey==='' && !!settings.elevenKey && !!settings.pexelsKey`);
  await run(`$('setGeminiKey').value='qa-key'; $('setGeminiKey').dispatchEvent(new Event('input')); $('geminiKeySaveBtn').click()`); await delay(70);
  win.setSize(1280,900); await run(`applyTheme('dark')`); await screenshot('settings-connections');
  win.setSize(900,640); await run(`applyTheme('light'); $('setGeminiKey').closest('.connection-card').scrollIntoView({block:'start'})`); await screenshot('settings-connections-compact');
  await check('Connection cards fit compact settings screen', `document.documentElement.scrollWidth<=innerWidth && $('viewSettings').scrollWidth<=$('viewSettings').clientWidth`);
  win.setSize(1280,900);
  await run(`switchView('cutter'); populateFromInfo(${JSON.stringify({ id: 'qa', title: 'Kurgu masası testi', duration: 90, previewUrl: pathToFileURL(source).href, localFile: source })}); for (const id of ['subEnable','trackEnable','wmEnable','titleEnable']) { $(id).checked=false; $(id).dispatchEvent(new Event('change')); } selectedFormats.clear(); selectedFormats.add('original'); refreshFormatButtons(); $('quality').value='best'; $('trimEnable').checked=true; $('trimEnable').dispatchEvent(new Event('change')); $('rangeStart').value=10; $('rangeEnd').value=30; syncFromSlider();`);
  await delay(500);
  await run(`$('sequenceAdd').click(); $('sequenceFit').click(); $('sequenceDesk').scrollIntoView({block:'center'})`);
  await check('Source selection becomes a non-destructive sequence clip', `sequenceProject().clips.length===1 && sequenceProject().clips[0].start===10 && buildOpts().opts.sequence[0].end===30`);
  await run(`(() => { const r=$('sequenceRuler').getBoundingClientRect(); $('sequenceRuler').dispatchEvent(new MouseEvent('click',{clientX:r.left+($('sequenceClips').firstChild.getBoundingClientRect().width/4),bubbles:true})); $('sequenceSplit').click(); })()`);
  await check('Playhead split creates adjacent source ranges', `sequenceProject().clips.length===2 && Math.abs(sequenceProject().clips[0].end-15)<.05`);
  await run(`$('sequenceLeft').click()`);
  await check('Selected fragment moves before its neighbour', `Math.abs(sequenceProject().clips[0].start-15)<.05 && sequenceProject().clips[1].start===10`);
  await run(`$('sequenceIn').value=16; $('sequenceIn').dispatchEvent(new Event('change',{bubbles:true}))`); await delay(60);
  await check('Numeric trim changes only the selected fragment', `sequenceProject().clips[0].start===16 && sequenceProject().clips[1].start===10`);
  await run(`$('editUndo').click()`);
  await check('Undo restores the previous trim', `Math.abs(sequenceProject().clips[0].start-15)<.05`);
  await run(`$('editRedo').click()`);
  await check('Redo reapplies the trim', `sequenceProject().clips[0].start===16`);
  await run(`$('sequenceDuplicate').click()`);
  await check('Duplicate preserves source range with a new identity', `sequenceProject().clips.length===3 && sequenceProject().clips[0].id!==sequenceProject().clips[1].id`);
  await run(`$('sequenceDelete').click(); $('sequenceFit').click(); $('sequenceDesk').scrollIntoView({block:'center'})`);
  const dragPoints = await run(`(() => { const a=$('sequenceClips').children[0].getBoundingClientRect(),b=$('sequenceClips').children[1].getBoundingClientRect(); return {from:{x:Math.round(a.left+a.width/2),y:Math.round(a.top+25)},to:{x:Math.round(b.right-12),y:Math.round(b.top+25)}}; })()`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...dragPoints.from});
  win.webContents.sendInputEvent({type:'mouseMove',...dragPoints.to});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...dragPoints.to}); await delay(100);
  await check('Real pointer drag reorders clips', `sequenceProject().clips[0].start===10 && sequenceProject().clips[1].start===16`);
  const handle = await run(`(() => { const r=$('sequenceClips').children[1].querySelector('.sequence-handle.end').getBoundingClientRect(); return {x:Math.round(r.left+4),y:Math.round(r.top+25)}; })()`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...handle});
  win.webContents.sendInputEvent({type:'mouseMove',x:handle.x-25,y:handle.y});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:handle.x-25,y:handle.y}); await delay(100);
  await check('Real trim handle changes the clip endpoint', `sequenceProject().clips[1].end<30 && sequenceProject().clips[1].end>28`);
  await run(`$('sequencePlay').click()`); await delay(150);
  await check('Sequence preview plays the selected edit order', `!$('preview').paused && $('sequencePlay').textContent.includes('Duraklat')`);
  await run(`$('sequencePlay').click(); window.savedSequenceProject=buildProject(); sequenceApplyProject(null); applyProjectSettings(savedSequenceProject,true)`);
  await check('Project restore retains order and trim decisions', `JSON.stringify(sequenceProject())===JSON.stringify(savedSequenceProject.sequence)`);
  await delay(800);
  await check('Automatic local draft reports successful persistence', `$('sessionSaveState').textContent.includes('Taslak kaydedildi')`);
  await run(`applyTheme('dark'); $('sequenceFit').click(); $('sequenceDesk').scrollIntoView({block:'center'})`); await screenshot('sequence-dark');
  win.setSize(900,640); await run(`applyTheme('light'); $('sequenceFit').click(); $('sequenceDesk').scrollIntoView({block:'center'})`); await screenshot('sequence-compact');
  await check('Sequence has no horizontal page overflow at compact size', `document.documentElement.scrollWidth<=innerWidth && $('sequenceDesk').scrollWidth<=$('sequenceDesk').clientWidth`);
  await run(`queue.splice(0); queue.push({opts:{...buildOpts().opts,title:'qa-retry'}},{opts:{...buildOpts().opts,title:'qa-success'}}); runQueueWorker()`); await delay(100);
  await check('Failed job is retained while later jobs complete', `queue.length===1 && queue[0].error==='Geçici test hatası' && !queueRunning`);
  await run(`document.querySelector('#queueList .btn-ghost').click()`); await delay(100);
  await check('Retry completes the retained failed job', `queue.length===0 && !queueRunning`);
  await delay(800);
  await win.loadFile(path.join(root, 'renderer/index.html')); await delay(400);
  await check('Fresh renderer offers the saved recovery draft', `!$('sessionRecovery').classList.contains('hidden')`);
  await run(`$('sessionRestore').click()`); await delay(700);
  await check('Recovery reopens source and restores the full edit sequence', `sequenceProject().clips.length===2 && sequenceProject().clips[0].start===10 && sequenceProject().clips[1].end<30 && $('sessionRecovery').classList.contains('hidden')`);
  await run(`$('proofOpen').click(); $('proofStart').value=1; $('proofGenerate').click()`);await delay(450);
  await check('Proof opens a playable video with current export options', `!$('proofVideo').classList.contains('hidden') && $('proofStatus').textContent.includes('hazır') && !window.outputProofBusy`);
  await delay(400); await screenshot('output-proof');
  await run(`$('proofStart').value=2; $('proofStart').dispatchEvent(new Event('input',{bubbles:true}))`);await delay(250);
  await check('Changing the proof range invalidates stale rendered video', `$('proofVideo').classList.contains('hidden') && $('proofStatus').textContent.includes('yeniden')`);
  await run(`$('proofGenerate').click()`);await delay(120);await run(`$('proofClose').click()`);await delay(300);
  await check('Closing an in-flight proof rejects late results', `$('proofModal').classList.contains('hidden') && $('proofVideo').classList.contains('hidden') && !window.outputProofBusy`);
  await run(`$('subEnable').checked=true; $('subEnable').dispatchEvent(new Event('change')); $('reviewGenerate').click()`); await delay(400);
  await run(`$('reviewSave').click(); closeTrackModal()`);
  await check('Profile test starts with an approved transcript', `!!reviewProject().doc?.approved`);
  await run(`$('packageEnable').checked=true; $('packageSrt').checked=true; $('packageTitle').value='Bölüm 1'; $('packageDescription').value='Yayın açıklaması'; $('packageCover').value=.5; $('layoutEnabled').checked=true; $('layoutBottom').value=35; $('layoutEnabled').dispatchEvent(new Event('change'));`);
  await check('Publication options include approved SRT and independent format layout', `buildOpts().opts.publishPackage.srt && buildOpts().opts.publishLayouts.vertical.bottom===35`);
  await run(`window.packageProject=buildProject(); publishingApply(null); applyProjectSettings(packageProject,true)`);
  await check('Project restore retains publication settings', `$('packageTitle').value==='Bölüm 1' && publishingProject().layouts.vertical.bottom===35`);
  await run(`$('packageCover').value=9999`);
  await check('Invalid publication cover time blocks enqueue', `buildOpts().error.includes('Kapak')`);
  await run(`$('packageCover').value=.5; $('publishPackagePanel').open=true; $('publishPackagePanel').scrollIntoView({block:'center'})`); await screenshot('publication-panel');
  await run(`$('publishProfiles').open=true; $('publishProfileName').value='Röportaj'; $('wmSize').value=14; $('titleSeconds').value=5; $('publishProfileSave').click()`); await delay(100);
  await check('Named visual profile saves successfully', `!!$('publishProfileSelect').value && $('publishProfileStatus').textContent.includes('kaydedildi')`);
  await run(`globalThis.profileBefore=JSON.stringify([currentLocalFile,currentRange(),sequenceProject(),reviewProject().doc]); $('wmSize').value=6; $('titleSeconds').value=3; $('publishProfileApply').click()`);
  await check('Applying a profile restores visual settings and preserves edit content', `+$('wmSize').value===14 && +$('titleSeconds').value===5 && JSON.stringify([currentLocalFile,currentRange(),sequenceProject(),reviewProject().doc])===profileBefore`);
  await run(`$('editUndo').click()`);
  await check('Profile application is undoable', `+$('wmSize').value===6 && +$('titleSeconds').value===3`);
  await run(`$('publishProfileName').value='Röportaj'; $('publishProfileSave').click()`); await delay(100);
  await check('Duplicate profile names do not overwrite saved profiles', `$('publishProfileSelect').options.length===2 && $('publishProfileStatus').textContent.includes('zaten')`);
  await run(`$('publishProfiles').scrollIntoView({block:'center'})`); await screenshot('publish-profiles');
  await win.loadFile(path.join(root,'renderer/index.html')); await delay(400);
  await check('Profiles remain available after renderer restart', `$('publishProfileSelect').options.length===2 && $('publishProfileSelect').options[1].text==='Röportaj'`);
  await run(`$('publishProfileSelect').selectedIndex=1; $('publishProfileSelect').dispatchEvent(new Event('change')); $('publishProfileDelete').click()`); await delay(100);
  await check('Profile removal persists', `$('publishProfileSelect').options.length===1 && $('publishProfileStatus').textContent.includes('silindi')`);
  // Anlatımlı video: kaynak → onaylı senaryo → üretim → kurgu masası (parçalar + altyazı taslağı)
  await run(`localStorage.removeItem('trimtube.voiceVideo.draft')`); await win.loadFile(path.join(root,'renderer/index.html')); await delay(500);
  await run(`settings.geminiKey='stored'; switchView('voice'); $('vvText').value=''; $('vvText').dispatchEvent(new Event('input'))`);
  await check('Narrated video waits for enough source text', `$('vvScriptBtn').disabled && $('vvReview').classList.contains('hidden')`);
  await check('Visual style picker replaces free design and starts on the default theme', `!document.getElementById('vvDesignSeg') && $('vvThemeName').textContent==='Neon Gece' && !!$('vvThemeThumb').querySelector('.vv-tp')`);
  await run(`$('vvThemeOpen').click()`); await delay(250);
  await check('Theme library opens as a modal with previews for every built-in theme and a create card', `!$('vvThemeModal').classList.contains('hidden') && document.querySelectorAll('#vvThemeGrid .vv-theme-card:not(.vv-theme-add) .vv-tp').length===4 && !!document.querySelector('#vvThemeGrid .vv-theme-add') && document.querySelector('#vvThemeGrid .vv-theme-card.active b').textContent==='Neon Gece'`);
  await screenshot('voice-theme-library');
  await run(`[...document.querySelectorAll('#vvThemeGrid .vv-theme-card')].find(c=>c.querySelector('b')?.textContent==='Editoryal').click()`); await delay(100);
  await check('Choosing a theme updates the picker and is remembered', `$('vvThemeName').textContent==='Editoryal' && settings.voiceVideo.themeId==='editorial'`);
  await run(`document.querySelector('#vvThemeGrid .vv-theme-add').click()`); await delay(100);
  await run(`var ta=document.querySelector('#vvThemeForm .vv-theme-ai textarea'); ta.value='Renk sistemi sabit: #F9B233 sarı, kömür siyahı, kırık beyaz kâğıt; analog kolaj, maskeleme bandı, el çizimi oklar.'; ta.dispatchEvent(new Event('input')); [...document.querySelectorAll('#vvThemeForm button')].find(b=>b.textContent==='Gemini ile oluştur').click()`); await delay(300);
  await check('A design prompt becomes an editable theme with a live preview', `${(()=>{const c=calls.filter(c=>c.channel==='vv-theme-from-prompt').at(-1);return !!c&&c.data.prompt.includes('#F9B233');})()} && document.querySelector('#vvThemeForm input[type=text]').value==='Analog Kolaj' && !!document.querySelector('#vvThemePreview .vv-tp-torn') && !$('vvThemeEditor').classList.contains('hidden')`);
  await screenshot('voice-theme-editor');
  await run(`$('vvThemeSaveBtn').click()`); await delay(200);
  await check('Saved custom theme joins the library and becomes the selected style', `$('vvThemeName').textContent==='Analog Kolaj' && settings.voiceVideo.themeId==='custom-qa1' && [...document.querySelectorAll('#vvThemeGrid .vv-theme-card b')].some(b=>b.textContent==='Analog Kolaj')`);
  await run(`[...document.querySelectorAll('#vvThemeGrid .vv-theme-card')].find(c=>c.querySelector('b')?.textContent==='Analog Kolaj').querySelectorAll('button').forEach(b=>b.textContent==='Dışa aktar'&&b.click())`); await delay(100);
  await check('A custom theme exports to a file; built-in themes have no export button', `${JSON.stringify(calls.filter(c=>c.channel==='vv-theme-export').at(-1)?.data)==='["custom-qa1"]'} && $('vvThemeStatus').textContent.includes('temalar.trimtube-theme') && ![...document.querySelectorAll('#vvThemeGrid .vv-theme-card')].find(c=>c.querySelector('b')?.textContent==='Editoryal').textContent.includes('Dışa aktar') && !$('vvThemeTools').classList.contains('hidden')`);
  await run(`$('vvThemeImportBtn').click()`); await delay(150);
  await check('Imported themes appear in the library right away', `[...document.querySelectorAll('#vvThemeGrid .vv-theme-card b')].some(b=>b.textContent==='İçe aktarılan') && $('vvThemeStatus').textContent.includes('1 tema eklendi')`);
  await run(`$('vvThemeClose').click(); $('vvDesignNote').value='Sakin ve ferah olsun, rakamları vurgula'; $('vvDesignNote').dispatchEvent(new Event('input')); $('vvDesignNote').dispatchEvent(new Event('change'))`);
  await run(`$('vvText').value='Bu bir deneme kaynağıdır. '.repeat(4); $('vvText').dispatchEvent(new Event('input')); $('vvScriptBtn').click()`); await delay(400);
  await check('Script appears for review before any voice generation', `$('vvScenes').children.length===2 && !$('vvReview').classList.contains('hidden') && !$('vvProduceBtn').disabled`);
  await check('Script request carries the chosen theme and the design note', `${(()=>{const d=calls.filter(c=>c.channel==='vv-script').at(-1)?.data;return d?.themeId==='custom-qa1'&&d.designNote.includes('rakamları')&&!('design' in d);})()} && $('vvThemeModal').classList.contains('hidden')`);
  await run(`var card=document.querySelectorAll('#vvScenes .vv-scene')[1]; card.querySelector('.vv-visual').open=true; var sel=[...card.querySelectorAll('.vv-direction select')]; sel[0].value='giant'; sel[0].dispatchEvent(new Event('change')); sel[2].value='cut'; sel[2].dispatchEvent(new Event('change'))`);
  await check('Scene director controls offer variants for the scene type', `(()=>{const card=document.querySelectorAll('#vvScenes .vv-scene')[1];const opts=[...card.querySelector('.vv-direction select').options].map(o=>o.value);return opts.includes('ring')&&opts.includes('giant')&&opts.includes('bar')&&!!card.querySelector('.vv-direction legend');})()`);
  await check('Gemini tag palette offers its own tones', `[...document.querySelectorAll('#vvTagHelp .vv-chip')].some(c=>c.textContent==='[empathetic]') && ![...document.querySelectorAll('#vvTagHelp .vv-chip')].some(c=>c.textContent==='[sarcastic]')`);
  await run(`var ta=document.querySelector('#vvScenes .vv-narration'); ta.value='[excited] Selam [foo] dünya'; ta.dispatchEvent(new Event('input'))`);
  await check('Unknown tags are flagged before voicing', `document.querySelector('#vvScenes .vv-warn').textContent.includes('[foo]')`);
  await run(`document.querySelector('[data-vv-tts="eleven"]').click()`); await delay(100);
  await check('Switching to ElevenLabs swaps the tag dictionary and flags unsupported tones', `[...document.querySelectorAll('#vvTagHelp .vv-chip')].some(c=>c.textContent==='[sarcastic]') && document.querySelectorAll('#vvScenes .vv-warn')[1].textContent.includes('[empathetic]')`);
  await run(`document.querySelector('[data-vv-tts="gemini"]').click(); var ta=document.querySelector('#vvScenes .vv-narration'); ta.value='[excited] Selam! [laughs] Bugün harika bir konu var.'; ta.dispatchEvent(new Event('input')); [...document.querySelectorAll('#vvScenes .vv-scene')[0].querySelectorAll('button')].find(b=>b.textContent==='Dosya seç…').click()`); await delay(200); await run(`document.querySelector('#vvScenes .vv-cut-row input').click()`); await delay(250);
  await check('Background removal previews the cut-out on a transparency grid before production', `${calls.filter(c=>c.channel==='vv-cutout').at(-1)?.data.path==='C:/qa/urun.png'} && !!document.querySelector('#vvScenes .vv-media-preview.cut img[src^="data:image/png"]') && document.querySelector('#vvScenes .vv-cut-row input').checked`);
  await run(`$('vvMusicPick').click()`); await delay(200); await run(`$('vvProduceBtn').click()`); await delay(500);
  await check('Music bed and sound effect choices travel with the production request', `${(()=>{const d=calls.filter(c=>c.channel==='vv-produce').at(-1)?.data;return d?.music?.path==='C:/qa/fon.mp3'&&d.music.level===.3&&d.sfx===true;})()} && $('vvMusicName').textContent==='fon.mp3' && !$('vvMusicOpts').classList.contains('hidden')`);
  await check('Theme and director overrides travel with the production request', `${(()=>{const d=calls.filter(c=>c.channel==='vv-produce').at(-1)?.data;return d?.themeId==='custom-qa1'&&d.scenes[1].direction.variant==='giant'&&d.scenes[1].direction.transition==='cut'&&!('design' in d)&&d.safeArea===true;})()}`);
  await check('Reels safe area is on by default with a preview guide toggle', `$('vvSafeArea').checked && !$('vvSafeRow').classList.contains('hidden') && !$('vvGuideRow').classList.contains('hidden') && (()=>{$('vvShowGuide').checked=true;$('vvShowGuide').dispatchEvent(new Event('change'));const on=!$('vvSafeGuide').classList.contains('hidden');$('vvShowGuide').checked=false;$('vvShowGuide').dispatchEvent(new Event('change'));return on&&$('vvSafeGuide').classList.contains('hidden');})()`);
  await check('Chosen scene media is attached and travels with the production request', `${calls.filter(c=>c.channel==='vv-produce').at(-1)?.data.scenes[0].media?.path==='C:/qa/urun.png' && calls.filter(c=>c.channel==='vv-produce').at(-1)?.data.scenes[0].media?.cutout===true} && document.querySelector('#vvScenes .vv-media-label').textContent.includes('urun.png')`);
  await check('Production sends the approved scenes and shows a playable result', `!$('vvResult').classList.contains('hidden') && !!$('vvPreview').getAttribute('src') && !$('vvToDeskBtn').classList.contains('hidden')`);
  await run(`document.querySelector('#vvScenes .vv-visual').open=true; $('vvReview').scrollIntoView({block:'start'})`); await screenshot('voice-video-review');
  await run(`$('vvResult').scrollIntoView({block:'center'})`); await screenshot('voice-video-result');
  await run(`var ta=document.querySelector('#vvScenes .vv-narration'); ta.value=ta.value+' Ek cümle.'; ta.dispatchEvent(new Event('input'))`);
  await check('Edits after production offer an incremental update and hide stale hand-off', `$('vvProduceBtn').textContent.includes('Değişiklikleri') && $('vvToDeskBtn').classList.contains('hidden')`);
  await run(`$('vvProduceBtn').click()`); await delay(500);
  for (const [w, h, name] of [[1680, 1000, 'voice-wide'], [1280, 800, 'voice-compact']]) {
    win.setSize(w, h); await run(`$('sideNav').classList.add('collapsed')`); await delay(350); await screenshot(name);
    await check(`Narrated video workspace fits ${w}x${h} without page scrolling; columns scroll on their own`, `(()=>{const v=$('viewVoice');const cols=[...document.querySelectorAll('#viewVoice .vv-col')];return v.scrollHeight<=v.clientHeight+1 && [...document.querySelectorAll('#viewVoice .vv-col-body')].every(b=>b.scrollWidth<=b.clientWidth+1) && cols.every(c=>c.getBoundingClientRect().bottom<=innerHeight+1) && document.documentElement.scrollWidth<=innerWidth && !$('vvStage').classList.contains('hidden') && $('vvStage').classList.contains('has-video') && document.querySelector('#vvSteps li.active')?.dataset.step==='3';})()`);
  }
  win.setSize(1280, 900); await delay(200);
  await run(`$('vvToDeskBtn').click()`); await delay(900);
  await check('Hand-off loads scenes as desk clips and subtitles as an unapproved layer', `currentView==='cutter' && sequenceProject().clips.length===2 && sequenceProject().enabled && reviewProject().doc?.cues.length===3 && !reviewProject().doc.approved && $('subEnable').checked`);

  await win.loadFile(path.join(root,'renderer/index.html')); await delay(500); await run(`switchView('voice')`); await delay(200);
  await check('Narrated video script draft survives a renderer restart', `$('vvScenes').children.length===2 && $('vvTitle').value==='Test anlatımı' && document.querySelector('#vvScenes .vv-narration').value.includes('Ek cümle')`);
  if (errors.length) throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, waveformRequests: calls.filter(c => c.channel === 'waveform').length }, null, 2));
  app.exit(0);
}).catch(error => {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, failure: error.stack }, null, 2));
  app.exit(1);
});
