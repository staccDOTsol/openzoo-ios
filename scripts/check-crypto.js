#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nacl = require(path.join(__dirname, '../www/vendor/nacl-fast.min.js'));

const sandbox = { window: {}, globalThis: {}, nacl, console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../www/vendor/bs58.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../www/js/openzoo-crypto.js'), 'utf8'), sandbox);

const { bs58, OpenZooCrypto } = sandbox;
const pair = nacl.sign.keyPair();
const address = bs58.encode(pair.publicKey);
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
  const built = await fetch('https://x402-tokens.fly.dev/v1/pay/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'openzoo-ios' },
    body: JSON.stringify({ accept: row, payer: address })
  }).then((r) => {
    if (!r.ok) throw new Error('pay/build ' + r.status);
    return r.json();
  });
  const unsigned = OpenZooCrypto.base64ToBytes(built.transaction);
  const signed = OpenZooCrypto.partialSignTx(unsigned, pair.secretKey);
  const sig = signed.subarray(1, 65);
  const zero = sig.every((b) => b === 0);
  if (zero) throw new Error('signature slot still empty');
  const ok = nacl.sign.detached.verify(signed.subarray(1 + 64 * signed[0]), sig, pair.publicKey);
  // message starts after compact-u16 + signatures; for 1-byte count this is fine when count < 128
  const numSigs = unsigned[0];
  const message = signed.subarray(1 + 64 * numSigs);
  const verified = nacl.sign.detached.verify(message, signed.subarray(1, 65), pair.publicKey);
  if (!verified) throw new Error('detached verify failed');
  console.log('partialSign ok, signed bytes', signed.length);
  console.log('check-crypto: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
