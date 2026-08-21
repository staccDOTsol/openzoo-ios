#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const model = require('../www/js/chat-model.js');
const race = require('../www/js/chat-race.js');
const spill = require('../www/js/chat-spill.js');

assert.strictEqual(model.AUTO_MODEL, 'openzoo/auto');
assert.strictEqual(model.AUTO_LABEL, 'Auto');
assert.strictEqual(model.DEFAULT_MODEL, 'openzoo/auto');
assert.ok(model.isAutoModel(''));
assert.ok(model.isAutoModel('Auto'));
assert.ok(model.isAutoModel('auto'));
assert.ok(model.isAutoModel('openzoo/auto'));
assert.ok(!model.isAutoModel('openai/gpt-4o-mini'));
assert.ok(!model.isAutoModel('x-ai/grok-4.6'));
assert.ok(!model.isAutoModel('openrouter/auto'), 'openrouter/auto is a named slug, not door Auto');

assert.strictEqual(model.resolveChatModel(null), 'openzoo/auto');
assert.strictEqual(model.resolveChatModel('Auto'), 'openzoo/auto');
assert.strictEqual(model.resolveChatModel('openzoo/auto'), 'openzoo/auto');
assert.strictEqual(model.resolveChatModel('openai/gpt-4o-mini'), 'openai/gpt-4o-mini');
assert.strictEqual(model.resolveChatModel('x-ai/grok-4.6'), 'x-ai/grok-4.6');

const catalog = model.catalogModelIds([
  { id: 'openzoo/auto' },
  { id: '~hidden/latest' },
  { id: 'openai/gpt-4o-mini' },
  { id: 'google/gemini-3.7-flash:batch' },
  { id: 'x-ai/grok-4.6' }
]);
assert.deepEqual(catalog, ['openzoo/auto', 'openai/gpt-4o-mini', 'x-ai/grok-4.6']);

const picker = model.pickerOptions(catalog, 'Auto');
assert.strictEqual(picker[0].value, 'openzoo/auto');
assert.strictEqual(picker[0].label, 'Auto');
assert.ok(picker[0].selected);
assert.ok(picker.some((row) => row.value === 'openai/gpt-4o-mini' && row.label === 'openai/gpt-4o-mini'));

const namedPicker = model.pickerOptions(catalog, 'x-ai/grok-4.6');
assert.strictEqual(namedPicker.filter((row) => row.selected)[0].value, 'x-ai/grok-4.6');

const cheapBand = race.tierPool('cheap');
assert.ok(cheapBand.indexOf('inclusionai/ling-3.0-flash') !== -1);
assert.ok(cheapBand.some((id) => id.indexOf('meta-llama/llama-4-') === 0));
const mediumBand = race.tierPool('medium');
assert.ok(mediumBand.indexOf('google/gemini-3.7-flash') !== -1);

const autoRace = model.planSend({
  model: 'Auto',
  raceSpec: { n: 4, k: 2 },
  tierModels: cheapBand
});
assert.strictEqual(autoRace.model, 'openzoo/auto');
assert.deepEqual(autoRace.models, ['openzoo/auto']);
assert.strictEqual(autoRace.race, false);
assert.ok(!autoRace.models.some((id) => /ling|llama|gemini|nemo/i.test(id)));

const autoDefault = model.planSend({ model: model.DEFAULT_MODEL, raceSpec: { n: 0, k: 1 } });
assert.strictEqual(autoDefault.model, 'openzoo/auto');
assert.deepEqual(autoDefault.models, ['openzoo/auto']);

const named = model.planSend({
  model: 'openai/gpt-4o-mini',
  raceSpec: { n: 0, k: 1 },
  tierModels: cheapBand
});
assert.strictEqual(named.model, 'openai/gpt-4o-mini');
assert.deepEqual(named.models, ['openai/gpt-4o-mini']);
assert.strictEqual(named.race, false);

const grok = model.planSend({ model: 'x-ai/grok-4.6', raceSpec: { n: 0, k: 1 } });
assert.strictEqual(grok.model, 'x-ai/grok-4.6');
assert.deepEqual(grok.models, ['x-ai/grok-4.6']);

const namedRace = model.planSend({
  model: 'openai/gpt-4o-mini',
  raceSpec: { n: 4, k: 2 },
  tierModels: mediumBand
});
assert.strictEqual(namedRace.race, true);
assert.ok(namedRace.models.length >= 2);
assert.notDeepEqual(namedRace.models, ['openzoo/auto']);

const autoBody = spill.buildChatRequest({
  model: autoRace.model,
  turns: [{ role: 'user', content: 'hi' }]
});
assert.strictEqual(autoBody.body.model, 'openzoo/auto');

const namedBody = spill.buildChatRequest({
  model: named.model,
  turns: [{ role: 'user', content: 'hi' }]
});
assert.strictEqual(namedBody.body.model, 'openai/gpt-4o-mini');

const fallback = spill.buildChatRequest({
  turns: [{ role: 'user', content: 'hi' }]
});
assert.strictEqual(fallback.body.model, 'openzoo/auto');

const app = fs.readFileSync(path.join(__dirname, '../www/app/app.js'), 'utf8');
assert.ok(app.indexOf('OpenZooChatModel.planSend') !== -1);
assert.ok(app.indexOf('OpenZooChatModel.resolveChatModel') !== -1);
assert.ok(app.indexOf('OpenZooChatModel.DEFAULT_MODEL') !== -1);
assert.ok(app.indexOf('openai/gpt-4o-mini') === -1, 'app default must not pin gpt-4o-mini');
assert.ok(!/\bTaskClassifier\b/.test(app));
assert.ok(!/pin.*gemini|tiny.?classif/i.test(app));

const helper = fs.readFileSync(path.join(__dirname, '../www/js/chat-model.js'), 'utf8');
assert.ok(!/\bTaskClassifier\b/.test(helper));
assert.ok(helper.indexOf("AUTO_MODEL = 'openzoo/auto'") !== -1);

const html = fs.readFileSync(path.join(__dirname, '../www/app/index.html'), 'utf8');
assert.ok(html.indexOf('js/chat-model.js') !== -1);
assert.ok(html.indexOf('js/chat-model.js') < html.indexOf('app.js'));

const billing = fs.readFileSync(path.join(__dirname, '../www/js/billing.js'), 'utf8');
assert.ok(billing.indexOf('Subscription keys · no x402') !== -1);

console.log('chat-model: ok');
console.log('  Auto → openzoo/auto in the chat body');
console.log('  named models stay named');
console.log('  Auto is never expanded into a race tier list');
