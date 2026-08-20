/* OpenZoo helpers: bytes, Solana partial-sign, TweetNaCl box encrypt. */
(function (root) {
  'use strict';

  function bytesToBase64(bytes) {
    var s = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesEq(a, b) {
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }

  function readCompactU16(bytes, offset) {
    var value = 0;
    var size = 0;
    var shift = 0;
    while (size < 3) {
      var byte = bytes[offset + size];
      value |= (byte & 0x7f) << shift;
      size++;
      if ((byte & 0x80) === 0) return { value: value, size: size };
      shift += 7;
    }
    throw new Error('invalid compact-u16');
  }

  function signerIndexInMessage(message, publicKey) {
    var off = 0;
    var versioned = (message[0] & 0x80) !== 0;
    if (versioned) off = 1;
    var numRequiredSigs = message[off];
    off += 3;
    var nacc = readCompactU16(message, off);
    off += nacc.size;
    for (var i = 0; i < numRequiredSigs; i++) {
      var key = message.subarray(off + i * 32, off + (i + 1) * 32);
      if (bytesEq(key, publicKey)) return i;
    }
    return -1;
  }

  /**
   * Insert an Ed25519 signature for our pubkey. Does not broadcast.
   * @param {Uint8Array} txBytes serialized unsigned/partially-signed tx
   * @param {Uint8Array} secretKey nacl.sign 64-byte secret
   */
  function partialSignTx(txBytes, secretKey) {
    var keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
    var nsig = readCompactU16(txBytes, 0);
    var sigStart = nsig.size;
    var message = txBytes.subarray(sigStart + nsig.value * 64);
    var idx = signerIndexInMessage(message, keyPair.publicKey);
    if (idx < 0) {
      throw new Error('This key is not a required signer on the pay/build transaction');
    }
    var sig = nacl.sign.detached(message, secretKey);
    var out = new Uint8Array(txBytes);
    out.set(sig, sigStart + idx * 64);
    return out;
  }

  function encryptPayload(payload, sharedSecret) {
    var nonce = nacl.randomBytes(24);
    var encrypted = nacl.box.after(
      new TextEncoder().encode(JSON.stringify(payload)),
      nonce,
      sharedSecret
    );
    return { nonce: nonce, bytes: encrypted };
  }

  function decryptPayload(dataB58, nonceB58, sharedSecret) {
    var opened = nacl.box.open.after(
      bs58.decode(dataB58),
      bs58.decode(nonceB58),
      sharedSecret
    );
    if (!opened) throw new Error('Unable to decrypt wallet payload');
    return JSON.parse(new TextDecoder().decode(opened));
  }

  root.OpenZooCrypto = {
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    bytesEq: bytesEq,
    partialSignTx: partialSignTx,
    encryptPayload: encryptPayload,
    decryptPayload: decryptPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
