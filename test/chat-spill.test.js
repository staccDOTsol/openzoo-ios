#!/usr/bin/env node
'use strict';

const assert = require('assert');
const spill = require('../www/js/chat-spill.js');

const turns = [];
for (let i = 0; i < 20; i++) {
  turns.push({ role: 'user', content: 'u' + i });
  turns.push({ role: 'assistant', content: 'a' + i });
}

const first = spill.buildChatRequest({
  model: 'openai/gpt-4o-mini',
  turns: turns.slice(0, 2),
  contextId: null
});
assert.strictEqual(first.mode, 'full');
assert.strictEqual(first.headers['X-HRR-Context'], undefined);
assert.strictEqual(first.body.messages[0].role, 'system');
assert.strictEqual(first.body.messages.length, 3);
assert.ok(!spill.isSkipSpillCombo(first.headers, first.body.messages, first.body.messages));

const later = spill.buildChatRequest({
  model: 'openai/gpt-4o-mini',
  turns: turns,
  contextId: 'ctx_thread_1'
});
assert.strictEqual(later.mode, 'tail');
assert.strictEqual(later.headers['X-HRR-Context'], 'ctx_thread_1');
assert.strictEqual(later.sent, spill.KEEP_TAIL);
assert.ok(later.total > later.sent);
assert.strictEqual(later.body.messages.length, 1 + spill.KEEP_TAIL);
assert.strictEqual(later.body.messages[0].role, 'system');
assert.strictEqual(later.tail[later.tail.length - 1].content, 'a19');
assert.ok(!spill.isSkipSpillCombo(later.headers, later.body.messages, turns));

assert.strictEqual(
  spill.isSkipSpillCombo({ 'X-HRR-Context': 'ctx_x' }, [{ role: 'system', content: 's' }].concat(turns), turns),
  true,
  'full thread + x-hrr-context is the grokui skip-spill combo'
);

const split = spill.splitPrefixTail(turns, 3);
assert.strictEqual(split.tail.length, 3);
assert.strictEqual(split.prefix.length, 37);
assert.ok(spill.prefixCorpus(split.prefix).indexOf('user: u0') === 0);
assert.ok(spill.prefixCorpus(split.prefix).indexOf('assistant: a17') !== -1);

assert.strictEqual(spill.captureContextId({ data: { context_id: 'ctx_body' } }), 'ctx_body');
assert.strictEqual(spill.captureContextId({
  data: {},
  headers: { get: function (k) { return k.toLowerCase() === 'x-hrr-context' ? 'ctx_hdr' : null; } }
}), 'ctx_hdr');

const hud = spill.emptyHud();
spill.noteHudReceipt(hud, { billedUsd: 0.01, directUsd: 0.08, savesVsDirect: 8 });
spill.noteHudReceipt(hud, { billedUsd: 0.02, directUsd: 0.10, savesVsDirect: 5 });
assert.strictEqual(hud.paidCalls, 2);
assert.ok(Math.abs(hud.spentUsd - 0.03) < 1e-12);
assert.ok(Math.abs(hud.directUsd - 0.18) < 1e-12);
assert.ok(Math.abs(spill.hudSavingX(hud) - (0.18 / 0.03)) < 1e-12, 'HUD is directUsd/spentUsd, not a sum of ratios');
assert.ok(Math.abs(spill.hudSavingX(hud) - 6) < 1e-12);
assert.notStrictEqual(spill.hudSavingX(hud), 8 + 5, 'never sum savesVsDirect');

const onlyRatio = spill.emptyHud();
spill.noteHudReceipt(onlyRatio, { billedUsd: 2, savesVsDirect: 4 });
assert.ok(Math.abs(onlyRatio.directUsd - 8) < 1e-12, 'per-call ratio becomes dollars, then we divide');
assert.ok(Math.abs(spill.hudSavingX(onlyRatio) - 4) < 1e-12);
assert.strictEqual(spill.formatSavingX(6), '6.00x');
assert.strictEqual(spill.formatSavingX(12.34), '12.3x');
assert.strictEqual(spill.formatSavingX(null), '—');

const store = {
  data: {},
  getItem: function (k) { return this.data[k] || null; },
  setItem: function (k, v) { this.data[k] = v; }
};
spill.saveHud(hud, store);
const reloaded = spill.loadHud(store);
assert.ok(Math.abs(spill.hudSavingX(reloaded) - 6) < 1e-12);

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../www/app/app.js'), 'utf8');
assert.ok(app.indexOf('OpenZooChatSpill.buildChatRequest') !== -1);
assert.ok(app.indexOf('OpenZooChatSpill.hudSavingX') !== -1);
assert.ok(!/headers\['X-HRR-Context'\] = thread\.contextId[\s\S]{0,200}thread\.messages\.filter/.test(app));

const html = fs.readFileSync(path.join(__dirname, '../www/app/index.html'), 'utf8');
assert.ok(html.indexOf('js/chat-spill.js') !== -1);
assert.ok(html.indexOf('id="hud-btn"') !== -1);

console.log('chat-spill: ok');
console.log('  first turn full, no x-hrr-context');
console.log('  later turn tail=' + later.sent + '/' + later.total + ' + context id');
console.log('  HUD', spill.formatSavingX(spill.hudSavingX(hud)), 'from direct/spent');
