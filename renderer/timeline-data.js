/* Shared edit decisions: seconds in the source, ordered on the output. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimelineData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MIN = .12, MAX = 100;
  const copy = x => JSON.parse(JSON.stringify(x));
  function validate(clips, duration) {
    if (!Array.isArray(clips) || !clips.length || clips.length > MAX || !Number.isFinite(duration) || duration <= 0) throw Error('Kurgu 1–100 parça içermeli.');
    return clips.map((c, i) => {
      if (!c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end > duration + .001 || c.end - c.start < MIN - .00001) throw Error(`${i + 1}. parçanın kaynak aralığı geçersiz.`);
      return { id: String(c.id || `clip-${i}`), start: c.start, end: Math.min(c.end, duration) };
    });
  }
  const duration = clips => clips.reduce((n, c) => n + c.end - c.start, 0);
  function locate(clips, time) {
    let offset = 0;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i], length = c.end - c.start;
      if (time < offset + length || i === clips.length - 1) return { index: i, source: c.start + Math.max(0, Math.min(length, time - offset)), offset };
      offset += length;
    }
    return null;
  }
  function split(clips, index, sourceTime, id) {
    const result = copy(clips), c = result[index];
    if (!c || sourceTime - c.start < MIN || c.end - sourceTime < MIN || clips.length >= MAX) throw Error('Bölme noktasının iki yanında en az 0,12 saniye bırak.');
    result.splice(index, 1, { ...c, end: sourceTime }, { ...c, id, start: sourceTime });
    return result;
  }
  function move(clips, from, to) {
    const result = copy(clips);
    if (from < 0 || from >= result.length || to < 0 || to >= result.length) return result;
    result.splice(to, 0, result.splice(from, 1)[0]); return result;
  }
  function covered(clips, start, end) { return clips.every(c => c.start >= start - .001 && c.end <= end + .001); }
  function remapCues(cues, clips, baseStart = 0) {
    const result = []; let offset = 0;
    for (const c of clips) {
      for (const cue of cues) {
        const start = Math.max(c.start, baseStart + cue.start), end = Math.min(c.end, baseStart + cue.end);
        if (end - start >= .01) result.push({ start: offset + start - c.start, end: offset + end - c.start, text: cue.text });
      }
      offset += c.end - c.start;
    }
    return result;
  }
  function remapPath(path, clips, baseStart = 0) {
    const result = []; let offset = 0;
    for (const c of clips) {
      const previous = path.filter(p => p.t + baseStart <= c.start).at(-1) || path[0];
      result.push({ t: offset, x: previous.x });
      for (const p of path) if (p.t + baseStart > c.start && p.t + baseStart < c.end) result.push({ t: offset + p.t + baseStart - c.start, x: p.x });
      offset += c.end - c.start;
    }
    return result;
  }
  function remapWords(words, clips, baseStart = 0) {
    let offset=0; const result=[];
    for(const [index,c] of clips.entries()) {
      for(const w of words) {
        const start=Math.max(c.start,baseStart+w.start),end=Math.min(c.end,baseStart+w.end);
        if(end>start) result.push({...w,start:offset+start-c.start,end:offset+end-c.start,cue:`${index}:${w.cue}`});
      }
      offset+=c.end-c.start;
    }
    return result;
  }
  return { MIN, MAX, copy, validate, duration, locate, split, move, covered, remapCues, remapPath, remapWords };
});
