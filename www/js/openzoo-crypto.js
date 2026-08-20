/* OpenZoo helpers: bytes, Solana partial-sign, TweetNaCl box encrypt. */
(function (root) {
  'use strict';

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function bytesToBase64(bytes) {
    var out = '';
    var i = 0;
    while (i < bytes.length) {
      var a = bytes[i++];
      var b = i < bytes.length ? bytes[i++] : NaN;
      var c = i < bytes.length ? bytes[i++] : NaN;
      var triple = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
      out += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63];
      out += isNaN(b) ? '=' : B64[(triple >> 6) & 63];
      out += isNaN(c) ? '=' : B64[triple & 63];
    }
    return out;
  }

  function base64ToBytes(b64) {
    var clean = String(b64).replace(/[^A-Za-z0-9+\/]/g, '');
    var len = clean.length;
    var out = new Uint8Array(Math.floor(len * 3 / 4));
    var p = 0;
    for (var i = 0; i < len; i += 4) {
      var a = B64.indexOf(clean.charAt(i));
      var b = B64.indexOf(clean.charAt(i + 1));
      var c = B64.indexOf(clean.charAt(i + 2));
      var d = B64.indexOf(clean.charAt(i + 3));
      out[p++] = (a << 2) | (b >> 4);
      if (c >= 0) out[p++] = ((b & 15) << 4) | (c >> 2);
      if (d >= 0) out[p++] = ((c & 3) << 6) | d;
    }
    return out.subarray(0, p);
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
