const assert = require('assert/strict');
const D = require('../renderer/timeline-data');
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const clips = [{ id: 'a', start: 5, end: 10 }, { id: 'b', start: 20, end: 25 }];
check('Ordered source intervals map to output time', () => { assert.equal(D.duration(clips), 10); assert.deepEqual(D.locate(clips, 5), { index: 1, source: 20, offset: 5 }); });
check('Splitting preserves duration and source continuity', () => { const result = D.split(clips, 0, 7, 'c'); assert.equal(D.duration(result), 10); assert.equal(result[0].end, result[1].start); assert.equal(clips.length, 2); });
check('Tiny fragments and excessive splits rejected', () => { assert.throws(() => D.split(clips, 0, 5.01, 'c')); assert.throws(() => D.validate(Array(101).fill(clips[0]), 30)); });
check('Invalid, reversed, NaN and out-of-source ranges rejected', () => { for (const c of [{ start: -1, end: 5 }, { start: 3, end: 2 }, { start: NaN, end: 5 }, { start: 0, end: 31 }]) assert.throws(() => D.validate([c], 30)); });
check('Reordering does not mutate source state', () => { const result = D.move(clips, 0, 1); assert.equal(result[0].id, 'b'); assert.equal(clips[0].id, 'a'); });
check('Subtitles reorder, trim and duplicate with their clips', () => {
  const cues = [{ start: 0, end: 3, text: 'ilk' }, { start: 15, end: 20, text: 'son' }];
  assert.deepEqual(D.remapCues(cues, [clips[1], clips[0], clips[1]], 5), [{ start: 0, end: 5, text: 'son' }, { start: 5, end: 8, text: 'ilk' }, { start: 10, end: 15, text: 'son' }]);
});
check('Camera state resets at each reordered clip boundary', () => { assert.deepEqual(D.remapPath([{ t: 0, x: .1 }, { t: 3, x: .4 }, { t: 12, x: .7 }], [clips[1], clips[0]], 5), [{ t: 0, x: .7 }, { t: 5, x: .1 }, { t: 8, x: .4 }]); });
check('Approval coverage rejects new unreviewed intervals', () => { assert.equal(D.covered(clips, 0, 15), false); assert.equal(D.covered(clips, 5, 25), true); });
console.log(JSON.stringify({ checks }, null, 2));
