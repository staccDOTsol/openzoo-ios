#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

global.nacl = require(path.join(__dirname, '../www/vendor/nacl-fast.min.js'));
eval(fs.readFileSync(path.join(__dirname, '../www/vendor/bs58.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../www/js/openzoo-crypto.js'), 'utf8'));

const pair = global.nacl.sign.keyPair();
const address = global.bs58.encode(pair.publicKey);
console.log('burner', address);

(async () => {
  const chat = await fetch('https://x402-tokens.fly.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'openzoo-ios' },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }]
    })
  });
  if (chat.status !== 402) throw new Error('expected 402, got ' + chat.status);
  const quote = await chat.json();
  const row = (quote.accepts || []).find((a) => a.asset === '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv');
  if (!row) throw new Error('yUSDCx rail missing');
  const builtRes = await fetch('https://x402-tokens.fly.dev/v1/pay/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'openzoo-ios' },
    body: JSON.stringify({ accept: row, payer: address })
  });
  if (!builtRes.ok) throw new Error('pay/build ' + builtRes.status + ' ' + await builtRes.text());
  const built = await builtRes.json();
  const unsigned = global.OpenZooCrypto.base64ToBytes(built.transaction);
  const signed = global.OpenZooCrypto.partialSignTx(unsigned, pair.secretKey);
  const numSigs = unsigned[0];
  if (numSigs >= 128) throw new Error('compact-u16 signature count needs a wider reader in this check');
  const message = signed.subarray(1 + 64 * numSigs);
  var verified = false;
  for (var i = 0; i < numSigs; i++) {
    var sig = signed.subarray(1 + 64 * i, 1 + 64 * (i + 1));
    if (sig.every(function (b) { return b === 0; })) continue;
    if (global.nacl.sign.detached.verify(message, sig, pair.publicKey)) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new Error('burner signature missing or did not verify');
  if (signed.subarray(1, 65).every(function (b) { return b === 0; })) {
    console.log('feePayer slot left unsigned (expected for x402 partial sign)');
  }
  const roundtrip = global.OpenZooCrypto.base64ToBytes(global.OpenZooCrypto.bytesToBase64(signed));
  if (roundtrip.length !== signed.length) throw new Error('base64 roundtrip length mismatch');
  console.log('partialSign ok, signed bytes', signed.length);
  console.log('check-crypto: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
