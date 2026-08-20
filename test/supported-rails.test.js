#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.nacl = require(path.join(__dirname, '../www/vendor/nacl-fast.min.js'));
eval(fs.readFileSync(path.join(__dirname, '../www/vendor/bs58.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../www/js/openzoo-crypto.js'), 'utf8'));

const rails = require('../www/js/rails.js');
const wrap = require('../www/js/wrap.js');
const wallet = require('../www/js/wallet-ios.js');
const errors = require('../www/js/user-errors.js');
const pay402 = require('../www/js/pay402.js');
const clipboard = require('../www/js/clipboard.js');
const http = require('../www/js/native-http.js');

const FXY = 'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B';
const BO7X = 'Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9';
const TOKEN = 'EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/supported.json'), 'utf8'));
const parsed = rails.parseSupported(fixture);

assert.strictEqual(rails.isDrainedMint(BO7X), true, 'drained Bo7x mint is rejected');
assert.ok(!parsed.rails[BO7X], 'drained mint is not a live rail');
assert.ok(parsed.rails[FXY], 'FXY mint is in the live directory');
assert.strictEqual(parsed.rails[FXY].symbol, 'wTOKENx2', 'FXY mint labels wTOKENx2');

const source = rails.wrapSource(parsed, FXY);
assert.ok(source, 'wTOKENx2 has a wrap source');
assert.strictEqual(source.underlying, TOKEN, 'TOKEN EVULo is the wrap source');
assert.strictEqual(source.underlyingSymbol, 'TOKEN');
assert.strictEqual(source.authorityBump, 254);

const accepts = [
  { scheme: 'exact', network: rails.SOLANA_NETWORK, asset: FXY, extra: { symbol: 'wTOKENx2' }, maxAmountRequired: '1000' },
  { scheme: 'exact', network: rails.SOLANA_NETWORK, asset: BO7X, extra: { symbol: 'wTOKENx' }, maxAmountRequired: '1000' },
  { scheme: 'exact', network: 'eip155:8453', asset: '0x8335', extra: { symbol: 'USDC' }, maxAmountRequired: '1000' }
];
const live = rails.liveAccepts(accepts, parsed);
assert.strictEqual(live.length, 1);
assert.strictEqual(rails.acceptSymbol(live[0], parsed), 'wTOKENx2');
assert.strictEqual(rails.deprecatedAccepts(accepts).length, 1);

const keys = wrap.wrapAccountKeys({
  escrow: 'escrow',
  wrappedMint: FXY,
  userWrappedAta: 'wrapped-ata',
  mintAuthority: 'auth',
  wrappedProgram: 'tok2022',
  userUnderlyingAta: 'under-ata',
  owner: 'owner',
  underlyingMint: TOKEN,
  underlyingProgram: 'tok2022'
});
assert.strictEqual(keys.length, 9, 'wrap uses nine accounts, not the old five');
assert.strictEqual(keys[5].pubkey, 'under-ata');
assert.strictEqual(keys[6].isSigner, true);
assert.strictEqual(keys[7].pubkey, TOKEN);

const holdings = wrap.holdingsMap([
  { mint: TOKEN, amount: '5000000', decimals: 6 },
  { mint: USDC, amount: '1000', decimals: 6 }
]);
const fundable = wrap.pickLargestUseful(holdings, [source, rails.wrapSource(parsed, '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv')], {
  [FXY]: 1000n,
  '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv': 1000n
});
assert.ok(fundable.length >= 1);
assert.strictEqual(fundable[0].symbol, 'TOKEN', 'largest useful holding is TOKEN');
const tenToken = wrap.pickLargestUseful(
  wrap.holdingsMap([{ mint: TOKEN, amount: '10000000', decimals: 6 }]),
  [source],
  { [FXY]: 1000000000n }
);
assert.strictEqual(tenToken.length, 1, '$10 TOKEN still wraps a tiny twin 402');
assert.strictEqual(wrap.pickLargestUseful(wrap.holdingsMap([]), [source], { [FXY]: 1n }).length, 0);
assert.ok(!/held < need/.test(fs.readFileSync(path.join(__dirname, '../www/js/wrap.js'), 'utf8')));

const hosts = [
  'x402-tokens.fly.dev',
  'x402.accrue.fund',
  'api.mainnet-beta.solana.com',
  'solana-rpc.publicnode.com'
];
const shellHtml = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '../www/app/index.html'), 'utf8');
hosts.forEach(function (host) {
  assert.ok(shellHtml.indexOf(host) !== -1, 'shell CSP covers ' + host);
  assert.ok(appHtml.indexOf(host) !== -1, 'app iframe CSP covers ' + host);
});
assert.ok(appHtml.indexOf('header-new-chat') !== -1);
assert.ok(appHtml.indexOf('>New chat<') !== -1);

assert.strictEqual(wrap.depositForShares(1000n, 0n, 0n), 2000n);

const phantomProv = wallet.PROVIDERS.phantom;
const solflareProv = wallet.PROVIDERS.solflare;
assert.strictEqual(phantomProv.appBase, 'phantom://v1/');
assert.strictEqual(phantomProv.redirect, 'openzoo://phantom');
assert.strictEqual(wallet.methodUrl(phantomProv, 'signTransaction', true), 'phantom://v1/signTransaction');
assert.strictEqual(wallet.methodUrl(phantomProv, 'connect', true), 'phantom://v1/connect');
assert.strictEqual(wallet.methodUrl(phantomProv, 'signAndSendTransaction', true), 'phantom://v1/signAndSendTransaction');
assert.strictEqual(wallet.methodUrl(phantomProv, 'signMessage', true), 'phantom://v1/signMessage');
assert.strictEqual(wallet.methodUrl(phantomProv, 'connect', false), 'phantom://v1/connect');
assert.strictEqual(wallet.methodUrl(phantomProv, 'connect', null), 'phantom://v1/connect');
assert.strictEqual(wallet.methodUrl(solflareProv, 'connect', true), 'solflare://ul/v1/connect');
assert.strictEqual(wallet.methodUrl(solflareProv, 'connect', false), 'https://solflare.com/ul/v1/connect');
assert.strictEqual(solflareProv.redirect, 'openzoo://solflare');

const phantomInstalled = wallet.openUrlPlan(phantomProv, 'connect', true);
assert.strictEqual(phantomInstalled.primary, 'phantom://v1/connect');
assert.strictEqual(phantomInstalled.fallback, 'https://phantom.app/ul/v1/connect');
assert.strictEqual(phantomInstalled.forceNative, true);
const phantomUnknown = wallet.openUrlPlan(phantomProv, 'connect', null);
assert.strictEqual(phantomUnknown.primary, 'phantom://v1/connect');
assert.strictEqual(phantomUnknown.forceNative, true);
const phantomMissing = wallet.openUrlPlan(phantomProv, 'connect', false);
assert.strictEqual(phantomMissing.primary, 'phantom://v1/connect');
assert.strictEqual(phantomMissing.fallback, 'https://phantom.app/ul/v1/connect');
const solflareInstalled = wallet.openUrlPlan(solflareProv, 'connect', true);
assert.strictEqual(solflareInstalled.primary, 'solflare://ul/v1/connect');
assert.strictEqual(solflareInstalled.forceNative, false);
const solflareMissing = wallet.openUrlPlan(solflareProv, 'connect', false);
assert.strictEqual(solflareMissing.primary, 'https://solflare.com/ul/v1/connect');
assert.strictEqual(solflareMissing.fallback, null);

assert.strictEqual(errors.sanitize(new Error('TypeError: Load failed')), 'The zoo could not reach the network. Try again.');
assert.strictEqual(errors.sanitize('Load failed'), 'The zoo could not reach the network. Try again.');
assert.strictEqual(errors.sanitize('Failed to fetch'), 'The zoo could not reach the network. Try again.');
assert.ok(!/load failed/i.test(errors.sanitize('TypeError: Load failed')));
assert.strictEqual(errors.sanitize('4001: User rejected the request'), '4001: User rejected the request');
assert.ok(errors.isLoadFailed(new TypeError('Load failed')));
assert.ok(errors.isRetryable(new TypeError('Load failed')));
assert.ok(errors.isRetryable(new Error('The zoo could not reach the network. Try again.')));
assert.ok(!errors.isRetryable(new Error('4001: User rejected the request')));

const mem = {
  data: {},
  setItem: function (k, v) { this.data[k] = String(v); },
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
  removeItem: function (k) { delete this.data[k]; }
};
const pending402 = { threadId: 't-1', userText: 'hi', accepts: [{ asset: FXY }], at: 1_000 };
assert.strictEqual(pay402.persist(pending402, mem), true);
assert.deepStrictEqual(pay402.load(mem), pending402);
assert.strictEqual(pay402.shouldRetryAfterResume(pending402, { now: 2_000, walletAddress: 'A', requireWallet: true }), true);
assert.strictEqual(pay402.shouldRetryAfterResume(pending402, { now: 2_000, hasPendingSign: true }), false);
assert.strictEqual(pay402.shouldRetryAfterResume(pending402, { now: 2_000, settleInFlight: true }), false);
assert.strictEqual(pay402.shouldRetryAfterResume(pending402, { now: pending402.at + pay402.MAX_AGE_MS + 1 }), false);
assert.strictEqual(pay402.shouldRetryAfterResume(pending402, { now: 2_000, requireWallet: true }), false);
assert.strictEqual(pay402.shouldRetryAfterResume(Object.assign({}, pending402, { terminal: true }), { now: 2_000 }), false);
pay402.clear(mem);
assert.strictEqual(pay402.load(mem), null);

let copied = '';
assert.strictEqual(clipboard.execCommandCopy('abc', {
  body: {
    appendChild: function () {},
    removeChild: function () {}
  },
  createElement: function () {
    return {
      value: '',
      style: {},
      setAttribute: function () {},
      focus: function () {},
      select: function () {},
      setSelectionRange: function () {},
      parentNode: { removeChild: function () {} }
    };
  },
  execCommand: function (cmd) {
    copied = cmd;
    return true;
  }
}), true);
assert.strictEqual(copied, 'copy');

const params = new URLSearchParams('errorCode=4001&errorMessage=User+rejected+the+request');
assert.strictEqual(wallet.walletError(params), '4001: User rejected the request');

const dapp = global.nacl.box.keyPair();
const peer = global.nacl.box.keyPair();
const shared = global.nacl.box.before(peer.publicKey, dapp.secretKey);
const phantomShared = global.nacl.box.before(dapp.publicKey, peer.secretKey);
const enc = global.OpenZooCrypto.encryptPayload({ transaction: 'abc', session: 'sess' }, shared);
const opened = global.nacl.box.open.after(enc.bytes, enc.nonce, phantomShared);
assert.ok(opened, 'Phantom nacl.box.after shared-secret decrypt works');
assert.strictEqual(JSON.parse(new TextDecoder().decode(opened)).session, 'sess');

clipboard.copyText('addr-1', {
  plugin: function (text, ok) { assert.strictEqual(text, 'addr-1'); ok(); }
}).then(function (via) {
  assert.strictEqual(via, 'plugin');
  return clipboard.copyText('addr-2', {
    clipboard: { writeText: function (text) { assert.strictEqual(text, 'addr-2'); return Promise.resolve(); } }
  });
}).then(function (via) {
  assert.strictEqual(via, 'clipboard-api');
  return http.request('https://x402-tokens.fly.dev/v1/models', {
    fetch: function (url, opts) {
      assert.ok(String(url).indexOf('x402-tokens.fly.dev') !== -1);
      assert.strictEqual(opts.method, 'GET');
      return Promise.resolve({ ok: true, status: 200 });
    }
  });
}).then(function (res) {
  assert.strictEqual(res.status, 200);
  return http.request('https://example.test', {
    fetch: function () { return Promise.resolve({ ok: true, status: 204 }); }
  });
}).then(function () {
  global.OpenZooWallet = {
    httpRequest: function (url, opts, ok) {
      assert.strictEqual(url, 'https://x402-tokens.fly.dev/v1/pay/build');
      ok({ status: 402, text: '{"accepts":[]}' });
    }
  };
  delete require.cache[require.resolve('../www/js/native-http.js')];
  const http2 = require('../www/js/native-http.js');
  return http2.request('https://x402-tokens.fly.dev/v1/pay/build', { method: 'POST' });
}).then(function (res) {
  assert.strictEqual(res.status, 402);
  return res.json();
}).then(function (body) {
  assert.ok(body && Array.isArray(body.accepts));
  console.log('supported-rails: ok');
  console.log('  FXY symbol', parsed.rails[FXY].symbol);
  console.log('  wrap source', source.underlyingSymbol, source.underlying);
  console.log('  drained rejected', BO7X);
  console.log('  phantom installed url', wallet.methodUrl(phantomProv, 'signTransaction', true));
  console.log('  phantom plan', wallet.openUrlPlan(phantomProv, 'connect', true).primary);
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
