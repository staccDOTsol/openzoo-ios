/* Minimal base58 encode/decode (Bitcoin / Solana alphabet). */
(function (root) {
  'use strict';
  var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var BASE = 58;
  var MAP = {};
  for (var i = 0; i < ALPHABET.length; i++) MAP[ALPHABET.charAt(i)] = i;

  function encode(bytes) {
    if (!bytes || !bytes.length) return '';
    var zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    var size = Math.ceil(bytes.length * 1.38) + 1;
    var b = new Uint8Array(size);
    var length = 0;
    for (var i = zeros; i < bytes.length; i++) {
      var carry = bytes[i];
      var j = 0;
      for (var k = size - 1; (carry !== 0 || j < length) && k !== -1; k--, j++) {
        carry += 256 * b[k];
        b[k] = carry % BASE;
        carry = (carry / BASE) | 0;
      }
      length = j;
    }
    var it = size - length;
    while (it < size && b[it] === 0) it++;
    var str = '';
    for (var z = 0; z < zeros; z++) str += '1';
    for (; it < size; it++) str += ALPHABET.charAt(b[it]);
    return str;
  }

  function decode(str) {
    if (typeof str !== 'string') throw new Error('bs58.decode expects a string');
    if (!str.length) return new Uint8Array(0);
    var zeros = 0;
    while (zeros < str.length && str.charAt(zeros) === '1') zeros++;
    var size = Math.ceil(str.length * 0.733) + 1;
    var b = new Uint8Array(size);
    var length = 0;
    for (var i = zeros; i < str.length; i++) {
      var carry = MAP[str.charAt(i)];
      if (carry === undefined) throw new Error('invalid base58 character');
      var j = 0;
      for (var k = size - 1; (carry !== 0 || j < length) && k !== -1; k--, j++) {
        carry += BASE * b[k];
        b[k] = carry % 256;
        carry = (carry / 256) | 0;
      }
      length = j;
    }
    var it = size - length;
    while (it < size && b[it] === 0) it++;
    var out = new Uint8Array(zeros + (size - it));
    var p = zeros;
    while (it < size) out[p++] = b[it++];
    return out;
  }

  root.bs58 = { encode: encode, decode: decode };
})(typeof window !== 'undefined' ? window : globalThis);
