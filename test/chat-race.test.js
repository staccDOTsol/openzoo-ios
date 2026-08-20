#!/usr/bin/env node
'use strict';

const assert = require('assert');
const race = require('../www/js/chat-race.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scriptedStream(spec) {
  return async function stream(_messages, onDelta, _ctx, model) {
    const s = spec[model];
    if (!s) throw new Error('unexpected model ' + model);
    if (s.err) {
      await sleep(s.at || 0);
      throw s.err;
    }
    const chunks = s.chunks || (s.text ? [s.text] : []);
    const start = Date.now();
    const tokenAt = s.tokenAt != null ? s.tokenAt : Math.max(0, (s.at || 0) - 20);
    await sleep(tokenAt);
    for (const c of chunks) onDelta(c);
    const left = Math.max(0, (s.at || 0) - (Date.now() - start));
    await sleep(left);
    return s.empty ? '' : (s.text ?? chunks.join(''));
  };
}

assert.strictEqual(race.formatRaceStatus(0, 2), 'racing 0/2 back…');
assert.strictEqual(race.formatRaceStatus(1, 2), 'racing 1/2 back…');
assert.strictEqual(race.formatRaceStatus(2, 2), 'racing 2/2 back…');
assert.strictEqual(race.formatRaceStatus(4, 2), 'racing 2/2 back…');

assert.deepEqual(race.parseRaceValue('0'), { n: 0, k: 1 });
assert.deepEqual(race.parseRaceValue('2'), { n: 2, k: 1 });
assert.deepEqual(race.parseRaceValue('2 4'), { n: 4, k: 2 });
assert.deepEqual(race.parseRaceValue('4 2'), { n: 4, k: 2 });
assert.deepEqual(race.parseRaceValue('best 2 of 4'), { n: 4, k: 2 });
assert.strictEqual(race.raceDialValue(4, 2), '2 4');
assert.strictEqual(race.DEFAULT_NEED, 2);
assert.strictEqual(race.DEFAULT_N, 4);

assert.strictEqual(race.normalizeTier('cheap'), 'cheap');
assert.strictEqual(race.normalizeTier('GROK 4.6'), 'grok4.6');
assert.strictEqual(race.normalizeTier('grok-4.6'), 'grok4.6');
assert.ok(race.TIER_NAMES.indexOf('cheap') !== -1);
assert.ok(race.TIER_NAMES.indexOf('medium') !== -1);
assert.ok(race.TIER_NAMES.indexOf('expensive') !== -1);
assert.ok(race.TIER_NAMES.indexOf('grok4.6') !== -1);
assert.deepEqual(race.tierPool('grok4.6'), [
  'x-ai/grok-4.6',
  'x-ai/grok-4.5',
  'x-ai/grok-4.3',
  'x-ai/grok-4.20'
]);

const four = race.tierModels('grok4.6', 4, true);
assert.strictEqual(four.length, 4);
assert.strictEqual(new Set(four).size, 4, 'race samples without replacement');
four.forEach((id) => assert.ok(id.indexOf('x-ai/grok-4.') === 0));

const catalog = new Set(['deepseek/deepseek-v4-flash', 'not-in-tier']);
const cheapLive = race.tierModels('cheap', 4, false, catalog);
assert.deepEqual(cheapLive, ['deepseek/deepseek-v4-flash']);

assert.equal(race.isRaceCountable(''), false);
assert.equal(race.isRaceCountable('fetch failed'), false);
assert.equal(race.isRaceCountable('TypeError: fetch failed'), false);
assert.equal(race.isRaceCountable('(mistral-large-2512 failed: fetch failed)'), false);
assert.equal(race.isRaceCountable('(upstream error — HTTP 502, try again)'), false);
assert.equal(race.isRaceCountable('(payment failed — HTTP 402 after 3 retries)'), false);
assert.equal(race.isRaceCountable({ text: 'ok', error: 'fetch failed' }), false);
assert.equal(race.isRaceCountable('DONE: built it'), true);
assert.equal(race.isRaceCountable('a real answer that mentions fetch failed in passing'), true);

assert.strictEqual(race.raceLastShip([]).text, race.RACE_EVERY_FAILED);
assert.doesNotMatch(race.raceLastShip([
  { model: 'mistralai/mistral-large-2512', text: '', error: 'fetch failed' }
]).text, /mistral-large-2512|failed: fetch failed/);

assert.strictEqual(race.parseClassifyScore('SCORE 8'), 8);
assert.strictEqual(race.parseClassifyScore('SCORE: 3'), 3);
assert.strictEqual(race.parseClassifyScore('no number here'), 0);

const picked = race.pickRaceWinner([
  { model: 'fast', text: 'weak', score: 3 },
  { model: 'better', text: 'strong', score: 9 }
], 6);
assert.strictEqual(picked.winner.model, 'better');
assert.strictEqual(race.pickRaceWinner([
  { model: 'a', text: 'first', score: 2 },
  { model: 'b', text: 'second', score: 4 }
], 6).winner.text, 'second');

assert.equal(race.shouldRetryRaceArrival({ text: '', error: 'fetch failed' }), true);
assert.equal(race.shouldRetryRaceArrival({ text: '(payment failed — HTTP 402 after 3 retries)' }), false);

async function runRaces() {
  let resolved = false;
  const deltas = [];
  const p = race.brainRace(
    [{ role: 'user', content: 'q' }],
    (d) => { if (!resolved && d) deltas.push(d); },
    null,
    ['fast', 'slow'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        fast: { chunks: ['Hel', 'lo'], text: 'Hello', at: 40, tokenAt: 5 },
        slow: { chunks: ['Bye'], text: 'Bye', at: 80, tokenAt: 60 }
      }),
      classify: async (_m, c) => (c.model === 'slow' ? 9 : 3)
    }
  );
  await sleep(20);
  assert.ok(deltas.length > 0, 'tokens must land before both racers finish');
  assert.ok(deltas.join('').includes('Hel'));
  const streamed = await p;
  resolved = true;
  assert.strictEqual(streamed, 'Bye');

  const statuses = [];
  await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['a', 'b', 'c'],
    2,
    undefined,
    (s) => statuses.push(s),
    {
      stream: scriptedStream({
        a: { text: 'one', at: 15 },
        b: { text: 'two', at: 35 },
        c: { text: 'three', at: 200 }
      }),
      classify: async (_m, c) => (c.model === 'b' ? 9 : 7)
    }
  );
  assert.ok(statuses.includes('racing 0/2 back…'));
  assert.ok(statuses.includes('racing 1/2 back…'));
  assert.ok(statuses.includes('racing 2/2 back…'));
  assert.strictEqual(statuses.filter((s) => s === 'racing 3/2 back…').length, 0);

  const classified = [];
  let cStarted = false;
  const t0 = Date.now();
  const firstTwo = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['empty', 'a', 'b', 'c'],
    2,
    undefined,
    () => {},
    {
      stream: async (_messages, onDelta, _ctx, model) => {
        if (model === 'empty') { await sleep(5); return ''; }
        if (model === 'a') { await sleep(15); onDelta('first'); return 'first'; }
        if (model === 'b') { await sleep(30); onDelta('second'); return 'second'; }
        cStarted = true;
        await sleep(250);
        onDelta('third');
        return 'third-should-not-win';
      },
      classify: async (_m, c) => {
        classified.push(c.model);
        return c.model === 'b' ? 9 : 8;
      }
    }
  );
  assert.deepEqual(classified.slice().sort(), ['a', 'b']);
  assert.strictEqual(firstTwo, 'second');
  assert.ok(cStarted, 'the 3rd is still launched');
  assert.ok(Date.now() - t0 < 180, 'must ship when X are in, not wait for N');

  const fallback = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['a', 'b', 'c'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        a: { text: 'first-back', at: 10 },
        b: { text: 'last-of-x', at: 25 },
        c: { text: 'late-high', at: 200 }
      }),
      classify: async () => 1,
      minScore: 6
    }
  );
  assert.strictEqual(fallback, 'last-of-x');

  const allFail = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['boom', 'blank', 'last'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        boom: { err: new Error('HTTP 502'), at: 5 },
        blank: { empty: true, text: '', at: 15 },
        last: { text: '(upstream error — HTTP 503, try again)', at: 30 }
      }),
      classify: async () => { throw new Error('classify must not run when X never fills'); }
    }
  );
  assert.strictEqual(allFail, race.RACE_EVERY_FAILED);
  assert.doesNotMatch(allFail, /boom|blank|last failed|HTTP 503/);

  const fetchFailedClassified = [];
  const fetchText = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    [
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7'
    ],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        'mistralai/mistral-large-2512': {
          err: Object.assign(new TypeError('fetch failed'), { name: 'TypeError' }),
          at: 5
        },
        'bytedance-seed/seed-2.0-code': { text: 'real-seed-answer', at: 25 },
        'deepseek/deepseek-v4-pro-0813': { text: 'real-deepseek-answer', at: 40 },
        'z-ai/glm-4.7': { text: 'late-should-not-enter', at: 200 }
      }),
      classify: async (_m, c) => {
        fetchFailedClassified.push(c.text);
        return c.text === 'real-deepseek-answer' ? 9 : 7;
      }
    }
  );
  assert.strictEqual(fetchText, 'real-deepseek-answer');
  assert.doesNotMatch(fetchText, /failed: fetch failed/);
  assert.deepEqual(fetchFailedClassified.slice().sort(), ['real-deepseek-answer', 'real-seed-answer']);

  const fetchAsText = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    [
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7'
    ],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        'mistralai/mistral-large-2512': { text: 'fetch failed', at: 5 },
        'bytedance-seed/seed-2.0-code': { empty: true, text: '', at: 8 },
        'deepseek/deepseek-v4-pro-0813': { text: 'ok-one', at: 25 },
        'z-ai/glm-4.7': { text: 'ok-two', at: 40 }
      }),
      classify: async (_m, c) => (c.text === 'ok-two' ? 9 : 7)
    }
  );
  assert.strictEqual(fetchAsText, 'ok-two');

  const everyFetch = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    [
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7'
    ],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        'mistralai/mistral-large-2512': { err: new TypeError('fetch failed'), at: 4 },
        'bytedance-seed/seed-2.0-code': { err: new TypeError('fetch failed'), at: 8 },
        'deepseek/deepseek-v4-pro-0813': { err: new TypeError('fetch failed'), at: 12 },
        'z-ai/glm-4.7': { err: new TypeError('fetch failed'), at: 16 }
      }),
      classify: async () => { throw new Error('classify must not run when every racer failed'); }
    }
  );
  assert.strictEqual(everyFetch, race.RACE_EVERY_FAILED);
  assert.doesNotMatch(everyFetch, /mistral-large-2512|failed: fetch failed/);

  const paySkip = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['pay', 'real1', 'real2', 'late'],
    2,
    undefined,
    () => {},
    {
      stream: scriptedStream({
        pay: { text: '(payment failed — HTTP 402 after 3 retries)', at: 5 },
        real1: { text: 'ok-one', at: 20 },
        real2: { text: 'ok-two', at: 35 },
        late: { text: 'late', at: 200 }
      }),
      classify: async (_m, c) => (c.text === 'ok-two' ? 9 : 7)
    }
  );
  assert.strictEqual(paySkip, 'ok-two');

  const tries = {};
  const retried = await race.brainRace(
    [{ role: 'user', content: 'q' }],
    () => {},
    null,
    ['flaky', 'good'],
    2,
    undefined,
    () => {},
    {
      stream: async (_messages, onDelta, _ctx, model) => {
        tries[model] = (tries[model] || 0) + 1;
        if (model === 'flaky' && tries[model] === 1) {
          await sleep(5);
          throw new TypeError('fetch failed');
        }
        await sleep(10);
        onDelta(model + '-ok');
        return model + '-ok';
      },
      classify: async (_m, c) => (c.model === 'flaky' ? 9 : 7)
    }
  );
  assert.strictEqual(tries.flaky, 2);
  assert.strictEqual(tries.good, 1);
  assert.strictEqual(retried, 'flaky-ok');

  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../www/app/app.js'), 'utf8');
  assert.ok(app.indexOf('OpenZooChatRace.brainRace') !== -1);
  assert.ok(app.indexOf('OpenZooChatRace.tierModels') !== -1);
  assert.ok(app.indexOf("id === 'raceSel'") !== -1 || app.indexOf('raceSel') !== -1);
  assert.ok(!/\bSPAWN\b|\bworktree|\bPING:/.test(app));
  assert.ok(app.indexOf('podagent') === -1);

  const html = fs.readFileSync(path.join(__dirname, '../www/app/index.html'), 'utf8');
  assert.ok(html.indexOf('js/chat-race.js') !== -1);
  assert.ok(html.indexOf('id="raceSel"') !== -1);
  assert.ok(html.indexOf('id="tierSel"') !== -1);
  assert.ok(html.indexOf('value="2 4"') !== -1);
  assert.ok(html.indexOf('value="grok4.6"') !== -1);
  assert.ok(html.indexOf('js/chat-spill.js') !== -1);

  const css = fs.readFileSync(path.join(__dirname, '../www/app/app.css'), 'utf8');
  assert.ok(css.indexOf('.dial.hot') !== -1);

  console.log('chat-race: ok');
  console.log('  first 2 of 4 judged; failures do not win');
  console.log('  all-fail is race-level, never (name failed: fetch failed)');
  console.log('  tiers cheap/medium/expensive/grok4.6');
}

runRaces().catch((err) => {
  console.error(err);
  process.exit(1);
});
