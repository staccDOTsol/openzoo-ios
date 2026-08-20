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

assert.strictEqual(wrap.depositForShares(1000n, 0n, 0n), 2000n);

const phantomProv = wallet.PROVIDERS.phantom;
assert.strictEqual(wallet.methodUrl(phantomProv, 'signTransaction', true), 'phantom://ul/v1/signTransaction');
assert.strictEqual(wallet.methodUrl(phantomProv, 'connect', true), 'phantom://ul/v1/connect');
assert.strictEqual(wallet.methodUrl(phantomProv, 'signTransaction', false), 'https://phantom.app/ul/v1/signTransaction');

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

console.log('supported-rails: ok');
console.log('  FXY symbol', parsed.rails[FXY].symbol);
console.log('  wrap source', source.underlyingSymbol, source.underlying);
console.log('  drained rejected', BO7X);
console.log('  phantom installed url', wallet.methodUrl(phantomProv, 'signTransaction', true));
