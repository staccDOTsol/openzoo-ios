/* Minimal Solana helpers: RPC, ATA, legacy tx. No web3.js. */
(function (root) {
  'use strict';

  var TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  var SYSTEM_PROGRAM = '11111111111111111111111111111111';
  var DEFAULT_RPCS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com'
  ];

  var ED25519_P = BigInt('57896044618658097711785492504343953926634992332820282019728792003956564819949');
  var ED25519_D = BigInt('37095705934669439343138083508754565189542113879843219016388785533085940283555');

  function decodeB58(s) {
    return bs58.decode(s);
  }
  function encodeB58(bytes) {
    return bs58.encode(bytes);
  }

  function concatBytes(parts) {
    var n = 0;
    parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n);
    var o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  function u8(n) { return new Uint8Array([n & 255]); }

  function u64le(n) {
    var x = typeof n === 'bigint' ? n : BigInt(String(n));
    var b = new Uint8Array(8);
    for (var i = 0; i < 8; i++) {
      b[i] = Number(x & 255n);
      x >>= 8n;
    }
    return b;
  }

  function readU64le(bytes, off) {
    var n = 0n;
    for (var i = 7; i >= 0; i--) n = (n << 8n) + BigInt(bytes[off + i]);
    return n;
  }

  function writeCompactU16(n) {
    if (n < 0x80) return u8(n);
    if (n < 0x4000) return new Uint8Array([ (n & 0x7f) | 0x80, n >> 7 ]);
    return new Uint8Array([ (n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14 ]);
  }

  function modP(x) {
    x %= ED25519_P;
    return x < 0n ? x + ED25519_P : x;
  }

  function powMod(b, e) {
    var r = 1n;
    b = modP(b);
    while (e > 0n) {
      if (e & 1n) r = modP(r * b);
      b = modP(b * b);
      e >>= 1n;
    }
    return r;
  }

  function bytesToBigIntLE(bytes) {
    var n = 0n;
    for (var i = bytes.length - 1; i >= 0; i--) n = (n << 8n) + BigInt(bytes[i]);
    return n;
  }

  function isOnCurve(pk) {
    if (!pk || pk.length !== 32) return false;
    var y = bytesToBigIntLE(pk) & ((1n << 255n) - 1n);
    if (y >= ED25519_P) return false;
    var y2 = modP(y * y);
    var u = modP(y2 - 1n);
    var v = modP(ED25519_D * y2 + 1n);
    if (v === 0n) return false;
    var x2 = modP(u * powMod(v, ED25519_P - 2n));
    var e = powMod(x2, (ED25519_P - 1n) / 2n);
    return e === 1n || x2 === 0n;
  }

  function sha256Bytes(bytes) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
        return new Uint8Array(buf);
      });
    }
    var nodeCrypto = require('crypto');
    return Promise.resolve(new Uint8Array(nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest()));
  }

  function findProgramAddress(seeds, programIdB58) {
    var program = decodeB58(programIdB58);
    var marker = new TextEncoder().encode('ProgramDerivedAddress');
    function tryBump(bump) {
      var parts = seeds.concat([u8(bump), program, marker]);
      return sha256Bytes(concatBytes(parts)).then(function (hash) {
        if (!isOnCurve(hash)) {
          return { address: encodeB58(hash), bump: bump, bytes: hash };
        }
        if (bump === 0) throw new Error('Unable to find program address');
        return tryBump(bump - 1);
      });
    }
    return tryBump(255);
  }

  function associatedTokenAddress(ownerB58, mintB58, tokenProgramB58) {
    tokenProgramB58 = tokenProgramB58 || TOKEN_PROGRAM;
    return findProgramAddress([
      decodeB58(ownerB58),
      decodeB58(tokenProgramB58),
      decodeB58(mintB58)
    ], ASSOCIATED_TOKEN_PROGRAM).then(function (pda) {
      return pda.address;
    });
  }

  function createAtaIdempotentIx(payer, ata, owner, mint, tokenProgram) {
    tokenProgram = tokenProgram || TOKEN_PROGRAM;
    return {
      programId: ASSOCIATED_TOKEN_PROGRAM,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false }
      ],
      data: u8(1)
    };
  }

  function compileLegacyMessage(feePayer, recentBlockhash, instructions) {
    var metas = {};
    function touch(pubkey, isSigner, isWritable) {
      var cur = metas[pubkey] || { pubkey: pubkey, isSigner: false, isWritable: false };
      cur.isSigner = cur.isSigner || isSigner;
      cur.isWritable = cur.isWritable || isWritable;
      metas[pubkey] = cur;
    }
    touch(feePayer, true, true);
    instructions.forEach(function (ix) {
      ix.keys.forEach(function (k) { touch(k.pubkey, k.isSigner, k.isWritable); });
      touch(ix.programId, false, false);
    });
    var keys = Object.keys(metas);
    function rank(a) {
      var m = metas[a];
      if (a === feePayer) return 0;
      if (m.isSigner && m.isWritable) return 1;
      if (m.isSigner && !m.isWritable) return 2;
      if (!m.isSigner && m.isWritable) return 3;
      return 4;
    }
    keys.sort(function (a, b) {
      var d = rank(a) - rank(b);
      return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
    });
    var signedWritable = 0;
    var signedReadonly = 0;
    var unsignedReadonly = 0;
    keys.forEach(function (k) {
      var m = metas[k];
      if (m.isSigner && m.isWritable) signedWritable++;
      else if (m.isSigner) signedReadonly++;
      else if (!m.isWritable) unsignedReadonly++;
    });
    var numRequiredSigs = signedWritable + signedReadonly;
    var header = new Uint8Array([
      numRequiredSigs,
      signedReadonly,
      unsignedReadonly
    ]);
    var accountBytes = concatBytes(keys.map(function (k) { return decodeB58(k); }));
    var bh = decodeB58(recentBlockhash);
    var compiled = instructions.map(function (ix) {
      var prog = keys.indexOf(ix.programId);
      var accs = ix.keys.map(function (k) { return keys.indexOf(k.pubkey); });
      return concatBytes([
        u8(prog),
        writeCompactU16(accs.length),
        new Uint8Array(accs),
        writeCompactU16(ix.data.length),
        ix.data
      ]);
    });
    var message = concatBytes([
      header,
      writeCompactU16(keys.length),
      accountBytes,
      bh,
      writeCompactU16(compiled.length)
    ].concat(compiled));
    var sigs = new Uint8Array(numRequiredSigs * 64);
    return concatBytes([writeCompactU16(numRequiredSigs), sigs, message]);
  }

  function rpcCall(url, method, params) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params })
    }).then(function (res) {
      return res.json();
    }).then(function (body) {
      if (body.error) throw new Error(body.error.message || 'RPC error');
      return body.result;
    });
  }

  function withRpcFallback(fn, rpcs) {
    rpcs = rpcs || DEFAULT_RPCS.slice();
    var last = new Error('No Solana RPC');
    function next(i) {
      if (i >= rpcs.length) return Promise.reject(last);
      return fn(rpcs[i]).catch(function (err) {
        last = err;
        return next(i + 1);
      });
    }
    return next(0);
  }

  function getLatestBlockhash() {
    return withRpcFallback(function (url) {
      return rpcCall(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }]).then(function (r) {
        return r.value.blockhash;
      });
    });
  }

  function getAccountInfo(pubkey) {
    return withRpcFallback(function (url) {
      return rpcCall(url, 'getAccountInfo', [pubkey, { encoding: 'base64' }]);
    });
  }

  function getBalanceLamports(pubkey) {
    return withRpcFallback(function (url) {
      return rpcCall(url, 'getBalance', [pubkey, { commitment: 'confirmed' }]).then(function (r) {
        return (r && r.value != null) ? r.value : 0;
      });
    });
  }

  function getParsedTokenAccounts(owner) {
    function one(programId) {
      return withRpcFallback(function (url) {
        return rpcCall(url, 'getTokenAccountsByOwner', [
          owner,
          { programId: programId },
          { encoding: 'jsonParsed', commitment: 'confirmed' }
        ]);
      }).then(function (r) {
        return (r && r.value) || [];
      }).catch(function () { return []; });
    }
    return Promise.all([one(TOKEN_PROGRAM), one(TOKEN_2022_PROGRAM)]).then(function (both) {
      var out = [];
      both.forEach(function (list) {
        list.forEach(function (row) {
          var info = row.account && row.account.data && row.account.data.parsed && row.account.data.parsed.info;
          if (!info) return;
          var tok = info.tokenAmount || {};
          out.push({
            pubkey: row.pubkey,
            mint: info.mint,
            amount: String(tok.amount || '0'),
            decimals: tok.decimals != null ? tok.decimals : 0,
            uiAmount: tok.uiAmount
          });
        });
      });
      return out;
    });
  }

  function getTokenBalance(owner, mint) {
    return getParsedTokenAccounts(owner).then(function (rows) {
      var raw = 0n;
      var decimals = 0;
      rows.forEach(function (row) {
        if (row.mint === mint) {
          raw += BigInt(row.amount || '0');
          decimals = row.decimals;
        }
      });
      return { raw: raw, decimals: decimals };
    });
  }

  function getTokenSupply(mint) {
    return withRpcFallback(function (url) {
      return rpcCall(url, 'getTokenSupply', [mint]).then(function (r) {
        return BigInt((r && r.value && r.value.amount) || '0');
      });
    });
  }

  function getTokenAccountBalance(pubkey) {
    return withRpcFallback(function (url) {
      return rpcCall(url, 'getTokenAccountBalance', [pubkey]).then(function (r) {
        return BigInt((r && r.value && r.value.amount) || '0');
      });
    }).catch(function () { return 0n; });
  }

  function sendRawTransaction(bytes) {
    var b64 = OpenZooCrypto.bytesToBase64(bytes);
    return withRpcFallback(function (url) {
      return rpcCall(url, 'sendRawTransaction', [b64, { encoding: 'base64', skipPreflight: false }]);
    });
  }

  function confirmSignature(signature, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    var started = Date.now();
    function poll() {
      return withRpcFallback(function (url) {
        return rpcCall(url, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
      }).then(function (r) {
        var st = r && r.value && r.value[0];
        if (st) {
          if (st.err) throw new Error('Top up did not land');
          if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
            return signature;
          }
        }
        if (Date.now() - started > timeoutMs) throw new Error('Top up is taking too long');
        return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(poll);
      });
    }
    return poll();
  }

  var api = {
    TOKEN_PROGRAM: TOKEN_PROGRAM,
    TOKEN_2022_PROGRAM: TOKEN_2022_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM: ASSOCIATED_TOKEN_PROGRAM,
    SYSTEM_PROGRAM: SYSTEM_PROGRAM,
    DEFAULT_RPCS: DEFAULT_RPCS,
    u64le: u64le,
    readU64le: readU64le,
    concatBytes: concatBytes,
    isOnCurve: isOnCurve,
    findProgramAddress: findProgramAddress,
    associatedTokenAddress: associatedTokenAddress,
    createAtaIdempotentIx: createAtaIdempotentIx,
    compileLegacyMessage: compileLegacyMessage,
    getLatestBlockhash: getLatestBlockhash,
    getAccountInfo: getAccountInfo,
    getBalanceLamports: getBalanceLamports,
    getParsedTokenAccounts: getParsedTokenAccounts,
    getTokenBalance: getTokenBalance,
    getTokenSupply: getTokenSupply,
    getTokenAccountBalance: getTokenAccountBalance,
    sendRawTransaction: sendRawTransaction,
    confirmSignature: confirmSignature
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooSolana = api;
})(typeof window !== 'undefined' ? window : globalThis);
