#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const billing = require('../www/js/billing.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/billing-tiers.json'), 'utf8'));
const catalog = billing.normalizeCatalog(fixture);

assert.strictEqual(billing.PRODUCT_IDS.basic, 'fun.openzoo.ios.sub.basic');
assert.strictEqual(billing.PRODUCT_IDS.pro, 'fun.openzoo.ios.sub.pro');
assert.strictEqual(billing.PRODUCT_IDS.ultra, 'fun.openzoo.ios.sub.ultra');
assert.strictEqual(billing.HIGHLIGHT_TIER, 'pro');
assert.strictEqual(billing.TAGLINE, 'Subscription keys · no x402');
assert.ok(!/stripe\.com/i.test(billing.CLOSE));

const byId = {};
catalog.tiers.forEach(function (t) { byId[t.id] = t; });
assert.strictEqual(byId.basic.monthlyCents, 900);
assert.strictEqual(byId.basic.priceLabel, '$9/mo');
assert.strictEqual(byId.basic.savingsSharePct, 40);
assert.strictEqual(byId.basic.rpm, 60);
assert.strictEqual(byId.basic.maxBindBytes, 33554432);
assert.strictEqual(byId.basic.maxTopK, 32);
assert.strictEqual(byId.pro.monthlyCents, 2900);
assert.strictEqual(byId.pro.priceLabel, '$29/mo');
assert.strictEqual(byId.pro.highlightLabel, 'Most teams want this');
assert.strictEqual(byId.ultra.monthlyCents, 9900);
assert.strictEqual(byId.ultra.priceLabel, '$99/mo');
assert.strictEqual(catalog.trialDays, 0);
assert.strictEqual(catalog.usageThresholdCents, 100);

assert.strictEqual(billing.productIdForTier('pro'), 'fun.openzoo.ios.sub.pro');
assert.strictEqual(billing.tierIdForProduct('fun.openzoo.ios.sub.ultra'), 'ultra');

return billing.exchangeAppStore({
  jws: 'test-jws',
  productId: 'fun.openzoo.ios.sub.pro',
  tier: 'pro'
}, function (url, opts) {
  assert.strictEqual(url, billing.APPSTORE_URL);
  assert.strictEqual(opts.method, 'POST');
  const body = JSON.parse(opts.body);
  assert.strictEqual(body.signedTransaction, 'test-jws');
  assert.strictEqual(body.tier, 'pro');
  assert.ok(!/checkout\.stripe\.com/.test(url));
  return Promise.resolve({
    status: 404,
    ok: false,
    text: function () { return Promise.resolve('<!DOCTYPE html>'); }
  });
}).then(function (ex) {
  assert.strictEqual(ex.ok, false);
  assert.strictEqual(ex.pending, true);
  assert.strictEqual(ex.todo, 'POST /api/billing/appstore');
  console.log('billing-tiers: ok');
  console.log('  basic', byId.basic.priceLabel, 'pro', byId.pro.priceLabel, 'ultra', byId.ultra.priceLabel);
  console.log('  appstore stub', ex.todo);
});
