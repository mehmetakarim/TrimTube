const assert = require('assert/strict');
const { parse, serialize, pathValid, wordsFromCues, animationEvents } = require('../renderer/review-data');
const { alignedWords, patchPath } = require('../renderer/review-data');
const tests = [];
function test(label, run) { run(); tests.push(label); }
const sample = '1\n00:00:00,000 --> 00:00:01,200\nİlk satır: çığ, öykü.\n\n2\n00:00:01,300 --> 00:00:02,000\nİkinci satır\n';
test('Acoustic timestamps survive punctuation and casing edits',()=> {const words=alignedWords([{start:0,end:2,text:'MERHABA, dünya!'}],[{start:.2,end:.7,word:'Merhaba'},{start:1.2,end:1.6,word:'dünya'}]);assert.equal(words[0].start,.2);assert.equal(words[1].start,1.2);assert.ok(words.every(w=>!w.estimated));});
test('Changed word is estimated without moving unchanged anchors',()=> {const words=alignedWords([{start:0,end:3,text:'bir yeni üç'}],[{start:.1,end:.4,word:'bir'},{start:1,end:1.6,word:'iki'},{start:2,end:2.5,word:'üç'}]);assert.equal(words[0].start,.1);assert.equal(words[2].start,2);assert.ok(words[1].estimated);});
test('Inserted words are never silently discarded when no gap exists',()=> {const words=alignedWords([{start:0,end:2,text:'bir yeni iki'}],[{start:0,end:1,word:'bir'},{start:1,end:2,word:'iki'}]);assert.equal(words.length,3);assert.ok(words.every(w=>w.estimated));});
test('Estimated timings never become measured by another reconciliation',()=> {const words=alignedWords([{start:0,end:2,text:'bir iki'}]);assert.ok(alignedWords([{start:0,end:2,text:'bir iki'}],words).every(w=>w.estimated));});
test('Range correction resumes previous camera movement at the boundary',()=> {const path=[{t:0,x:.1},{t:2,x:.2},{t:4,x:.4},{t:7,x:.7}];assert.deepEqual(patchPath(path,1,5,.8,10),[{t:0,x:.1},{t:1,x:.8},{t:5,x:.4},{t:7,x:.7}]);assert.equal(path[1].x,.2);assert.throws(()=>patchPath(path,5,1,.8,10));});
test('Turkish multiline text and milliseconds round-trip', () => assert.deepEqual(parse(serialize(parse(sample)), 2), parse(sample, 2)));
test('Overlapping cues rejected', () => assert.throws(() => parse(sample.replace('01,300', '00,900'), 2)));
test('Clip overflow rejected', () => assert.throws(() => parse(sample, 1)));
test('Empty transcript rejected', () => assert.throws(() => parse('', 2)));
test('Invalid timestamps rejected', () => assert.throws(() => parse(sample.replace('00:00:00', '00:70:00'), 2)));
test('Markup and ASS override text cannot inject formatting', () => assert.equal(parse('1\n00:00:00,000 --> 00:00:01,000\n<b>A</b>{\\pos(0,0)}')[0].text, 'Apos(0,0)'));
test('Camera timeline must start at zero and be ordered', () => { assert.ok(pathValid([{t:0,x:.2},{t:1,x:.3}],2)); assert.ok(!pathValid([{t:1,x:.2}],2)); assert.ok(!pathValid([{t:0,x:.2},{t:0,x:.3}],2)); });
test('Camera positions and times must be finite and inside bounds', () => { assert.ok(!pathValid([{t:0,x:NaN}],2)); assert.ok(!pathValid([{t:0,x:2}],2)); assert.ok(!pathValid([{t:0,x:.2},{t:3,x:.2}],2)); });
for (const style of ['vurgulu', 'pop']) {
  test(`${style}: adjacent groups never overlap after ASS rounding`, () => {
    const words = wordsFromCues([{ start: 0, end: 2, text: 'bir iki üç dört beş altı yedi sekiz' }, { start: 2, end: 3, text: 'yeni satır' }]);
    const events = animationEvents(words, style);
    assert.equal(events.length, 10);
    events.forEach((event, index) => { assert.ok(event.end > event.start); if (index) assert.ok(events[index - 1].end <= event.start); });
    assert.equal(events.at(-1).end, 3);
    const edge = events[4].start;
    assert.equal(events.filter(e => e.start <= edge && e.end > edge).length, 1);
    assert.deepEqual(events[4].words, style === 'pop' ? ['beş'] : ['beş', 'altı', 'yedi', 'sekiz']);
  });
}
test('Animation respects cue boundaries and silent gaps', () => {
  const events = animationEvents(wordsFromCues([{start:0,end:1,text:'önce'}, {start:1.1,end:2,text:'sonra'}]), 'vurgulu');
  assert.equal(events[0].end, 1); assert.deepEqual(events[0].words, ['önce']); assert.equal(events[1].start, 1.1);
});
test('Sub-centisecond words never produce empty or overlapping ASS events', () => {
  const events = animationEvents(wordsFromCues([{start:0,end:.03,text:'a b c d e f g h'}]), 'pop');
  events.forEach((e,i) => { assert.ok(e.end > e.start); if(i) assert.ok(events[i-1].end <= e.start); });
});
console.log(JSON.stringify({ checks: tests }, null, 2));
