(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReviewData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parse(srt, duration = Infinity) {
    if (typeof srt !== 'string' || srt.length > 2000000) throw Error('Altyazı metni geçersiz veya çok büyük.');
    const blocks = srt.replace(/\r/g, '').trim().split(/\n\s*\n/);
    const cues = []; let previous = 0;
    const seconds = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000;
    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      if (/^\d+$/.test(lines[0].trim())) lines.shift();
      const m = (lines.shift() || '').match(/^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/);
      if (!m) throw Error(`${cues.length + 1}. satırın zaman kodu geçersiz.`);
      const start = seconds(...m.slice(1, 5)), end = seconds(...m.slice(5, 9));
      const text = lines.join('\n').replace(/<[^>]*>/g, '').replace(/[{}\\]/g, '').trim();
      if (!text || start < previous || end <= start || end > duration + .1) throw Error(`${cues.length + 1}. altyazının metnini ve zaman aralığını kontrol edin (çakışma veya kesit dışı zaman).`);
      cues.push({ start, end, text }); previous = end;
    }
    if (!cues.length) throw Error('Bu kesitte altyazı bulunamadı.');
    return cues;
  }
  function stamp(t) {
    const ms = Math.round(t * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  }
  const serialize = cues => cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n') + '\n';
  function pathValid(points, duration) {
    return Array.isArray(points) && points.length > 0 && points.length <= 200000 && points[0].t === 0 && points.every((p, i) => Number.isFinite(p.t) && p.t >= 0 && p.t <= duration && Number.isFinite(p.x) && p.x >= 0 && p.x <= 1 && (!i || p.t > points[i - 1].t));
  }
  function wordsFromCues(cues) {
    const words = [];
    cues.forEach((cue, cueIndex) => {
      const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
      const total = tokens.reduce((sum, word) => sum + word.length + 2, 0);
      let t = cue.start;
      tokens.forEach(word => {
        const end = t + (cue.end - cue.start) * (word.length + 2) / total;
        words.push({ start: +t.toFixed(3), end: +end.toFixed(3), word, cue: cueIndex }); t = end;
      });
    });
    return words;
  }
  // Match edited text to measured words within each cue. Unchanged tokens retain
  // their acoustic timestamps; unmatched runs are explicitly estimated.
  function alignedWords(cues, measured = []) {
    const norm = text => String(text).toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
    const source = Array.isArray(measured) ? measured.slice(0, 50000).filter(w => typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start).sort((a,b) => a.start-b.start) : [];
    return cues.flatMap((cue, cueIndex) => {
      const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
      let low=0,high=source.length;
      while(low<high) {const mid=(low+high)>>1;if(source[mid].start<cue.start-.02)low=mid+1;else high=mid;}
      const candidates=[];
      for(let k=low;k<source.length&&source[k].start<=cue.end+.02;k++) if(source[k].end<=cue.end+.02) candidates.push(source[k]);
      if (!tokens.length) return [];
      if (tokens.length > 300 || candidates.length > 300) return wordsFromCues([cue]).map(w => ({...w, cue:cueIndex, estimated:true}));
      const rows = Array.from({length: tokens.length + 1}, () => new Uint16Array(candidates.length + 1));
      const tokenKeys=tokens.map(norm),wordKeys=candidates.map(w=>norm(w.word));
      for (let i=tokens.length-1;i>=0;i--) for(let j=candidates.length-1;j>=0;j--) rows[i][j] = tokenKeys[i] && tokenKeys[i]===wordKeys[j] ? 1+rows[i+1][j+1] : Math.max(rows[i+1][j], rows[i][j+1]);
      const anchors = new Map(); let i=0,j=0,last=cue.start;
      while (i<tokens.length && j<candidates.length) {
        if (tokenKeys[i] && tokenKeys[i]===wordKeys[j]) {
          const start=Math.max(cue.start,last,candidates[j].start), end=Math.min(cue.end,candidates[j].end);
          if (end>start) { anchors.set(i,{start,end,estimated:!!candidates[j].estimated}); last=end; } i++;j++;
        } else if(rows[i+1][j]>=rows[i][j+1]) i++; else j++;
      }
      const result=[]; i=0; last=cue.start;
      while(i<tokens.length) {
        if(anchors.has(i)) { const w=anchors.get(i); result.push({...w,word:tokens[i],cue:cueIndex}); last=w.end;i++;continue; }
        let end=i; while(end<tokens.length&&!anchors.has(end)) end++;
        const until=anchors.get(end)?.start??cue.end;
        const estimated=wordsFromCues([{start:last,end:until,text:tokens.slice(i,end).join(' ')}]);
        result.push(...estimated.filter(w=>w.end>w.start).map(w=>({...w,cue:cueIndex,estimated:true}))); i=end;last=until;
      }
      // No available gap for an inserted word: retain the complete edited text,
      // explicitly estimating this cue instead of silently dropping the insertion.
      if(result.length!==tokens.length) return wordsFromCues([cue]).map(w=>({...w,cue:cueIndex,estimated:true}));
      return result;
    });
  }
  function patchPath(path, start, end, x, duration) {
    if(!pathValid(path,duration)||![start,end,x].every(Number.isFinite)||start<0||end>duration||end<=start||x<0||x>1) throw Error('Kadraj düzeltme aralığı geçersiz.');
    const resume=path.filter(p=>p.t<=end).at(-1).x;
    return [...path.filter(p=>p.t<start),{t:start,x},...(end<duration?[{t:end,x:resume}]:[]),...path.filter(p=>p.t>end)];
  }
  // Shared by the browser preview and ASS export. Half-open, centisecond
  // intervals match ASS precision; never hold a group across its successor.
  function animationEvents(words, style) {
    const groups = []; let group;
    for (const word of words) {
      if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) continue;
      if (!group || group.words.length >= 4 || word.end - group.start > 2.5 || word.start - group.end > 1.2 || word.cue !== group.cue) {
        group = { start: word.start, end: word.end, cue: word.cue, words: [] }; groups.push(group);
      }
      group.words.push(word); group.end = word.end;
    }
    const events = [];
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      group.words.forEach((word, index) => {
        const start = Math.round(word.start * 100) / 100;
        const end = Math.round(Math.min(group.words[index + 1]?.start ?? group.end, groups[g + 1]?.start ?? Infinity) * 100) / 100;
        if (end <= start) return;
        events.push({ start, end, words: style === 'pop' ? [word.word] : group.words.map(w => w.word), active: style === 'pop' ? 0 : index });
      });
    }
    // Also protect consumers with overlapping word timestamps (e.g. Whisper).
    for (let i = 0; i < events.length - 1; i++) events[i].end = Math.min(events[i].end, events[i + 1].start);
    return events.filter(event => event.end > event.start);
  }
  return { parse, serialize, stamp, pathValid, wordsFromCues, alignedWords, patchPath, animationEvents };
});
