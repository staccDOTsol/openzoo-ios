/* Port of desktop openzoo wrap-nav: 9-account Wrap, program pulls the deposit. */
(function (root) {
  'use strict';

  var WRAP_PROGRAM = 'FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE';
  var MINIMUM_LIQUIDITY = 1000n;
  var TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

  function asBig(n) {
    if (typeof n === 'bigint') return n;
    return BigInt(String(n || '0'));
  }

  function depositForShares(sharesNeeded, reserves, supply) {
    var need = asBig(sharesNeeded);
    var res = asBig(reserves);
    var sup = asBig(supply);
    if (sup === 0n || res === 0n) return need + MINIMUM_LIQUIDITY;
    var exact = (need * res + sup - 1n) / sup;
    return exact + exact / 200n + 2n;
  }

  function wrapAccountKeys(opts) {
    return [
      { pubkey: opts.escrow, isSigner: false, isWritable: true },
      { pubkey: opts.wrappedMint, isSigner: false, isWritable: true },
      { pubkey: opts.userWrappedAta, isSigner: false, isWritable: true },
      { pubkey: opts.mintAuthority, isSigner: false, isWritable: false },
      { pubkey: opts.wrappedProgram, isSigner: false, isWritable: false },
      { pubkey: opts.userUnderlyingAta, isSigner: false, isWritable: true },
      { pubkey: opts.owner, isSigner: true, isWritable: false },
      { pubkey: opts.underlyingMint, isSigner: false, isWritable: false },
      { pubkey: opts.underlyingProgram, isSigner: false, isWritable: false }
    ];
  }

  function wrapIxData(depositRaw, bump) {
    var Sol = root.OpenZooSolana;
    return Sol.concatBytes([
      new Uint8Array([1]),
      Sol.u64le(depositRaw),
      new Uint8Array([bump & 255])
    ]);
  }

  function buildWrapInstruction(opts) {
    if (!opts.userUnderlyingAta || !opts.owner || !opts.underlyingMint || !opts.underlyingProgram) {
      throw new Error('Wrap needs the nine-account deposit path');
    }
    return {
      programId: opts.program || WRAP_PROGRAM,
      keys: wrapAccountKeys(opts),
      data: wrapIxData(opts.depositRaw, opts.bump)
    };
  }

  function buildWrapInstructions(opts) {
    var Sol = root.OpenZooSolana;
    var ataIx = Sol.createAtaIdempotentIx(
      opts.rentPayer || opts.owner,
      opts.userWrappedAta,
      opts.owner,
      opts.wrappedMint,
      opts.wrappedProgram
    );
    return [ataIx, buildWrapInstruction(opts)];
  }

  function pickLargestUseful(holdings, sources, needByMint) {
    var fundable = [];
    (sources || []).forEach(function (src) {
      if (!src || !src.underlying) return;
      var held = asBig((holdings[src.underlying] && holdings[src.underlying].raw) || 0);
      var need = src.mint && needByMint && needByMint[src.mint] != null
        ? asBig(needByMint[src.mint])
        : 1n;
      if (held <= 0n) return;
      if (held < need) return;
      fundable.push({
        source: src,
        held: held,
        need: need,
        symbol: src.underlyingSymbol,
        mint: src.mint
      });
    });
    fundable.sort(function (a, b) {
      if (a.held === b.held) return 0;
      return a.held > b.held ? -1 : 1;
    });
    return fundable;
  }

  function holdingsMap(tokenAccounts) {
    var map = {};
    (tokenAccounts || []).forEach(function (row) {
      var cur = map[row.mint] || { raw: 0n, decimals: row.decimals || 0 };
      cur.raw += asBig(row.amount);
      cur.decimals = row.decimals != null ? row.decimals : cur.decimals;
      map[row.mint] = cur;
    });
    return map;
  }

  function resolveWrapPlan(parsed, accept, tokenAccounts) {
    var Rails = root.OpenZooRails;
    var mint = Rails.acceptAsset(accept);
    var src = Rails.wrapSource(parsed, mint);
    if (!src) return null;
    var holdings = holdingsMap(tokenAccounts);
    var twinHeld = asBig((holdings[mint] && holdings[mint].raw) || 0);
    var need = asBig(accept.maxAmountRequired || '0');
    var underHeld = asBig((holdings[src.underlying] && holdings[src.underlying].raw) || 0);
    return {
      mint: mint,
      symbol: src.symbol,
      source: src,
      twinHeld: twinHeld,
      underHeld: underHeld,
      need: need,
      covered: twinHeld >= need,
      canWrap: underHeld > 0n
    };
  }

  function chooseEzTopup(parsed, accepts, tokenAccounts) {
    var Rails = root.OpenZooRails;
    var holdings = holdingsMap(tokenAccounts);
    var sources = [];
    var needByMint = {};
    (accepts || []).forEach(function (row) {
      var mint = Rails.acceptAsset(row);
      var src = Rails.wrapSource(parsed, mint);
      if (!src) return;
      var twinHeld = asBig((holdings[mint] && holdings[mint].raw) || 0);
      var need = asBig(row.maxAmountRequired || '0');
      if (twinHeld >= need) return;
      sources.push(src);
      needByMint[mint] = need > 0n ? need : 1n;
    });
    return pickLargestUseful(holdings, sources, needByMint);
  }

  function mintOwnerProgram(info) {
    if (!info || !info.value || !info.value.owner) return TOKEN_2022_PROGRAM;
    return info.value.owner;
  }

  function buildUnsignedWrapTx(opts) {
    var Sol = root.OpenZooSolana;
    var acq = opts.source.acquire;
    var owner = opts.owner;
    var depositRaw = opts.depositRaw;
    function bumpPromise() {
      var known = acq.authorityBump != null ? acq.authorityBump : opts.source.authorityBump;
      if (known != null) return Promise.resolve(known);
      var seed = new TextEncoder().encode('mint_authority');
      return Sol.findProgramAddress(
        [seed, bs58.decode(opts.source.mint)],
        acq.program || WRAP_PROGRAM
      ).then(function (pda) {
        return pda.bump;
      });
    }
    return Promise.all([
      Sol.associatedTokenAddress(owner, opts.source.mint, opts.wrappedProgram),
      Sol.associatedTokenAddress(owner, opts.source.underlying, opts.source.underlyingProgram || Sol.TOKEN_PROGRAM),
      Sol.getLatestBlockhash(),
      bumpPromise()
    ]).then(function (parts) {
      var userWrapped = parts[0];
      var userUnderlying = parts[1];
      var blockhash = parts[2];
      var bump = parts[3];
      var ixs = buildWrapInstructions({
        program: acq.program || WRAP_PROGRAM,
        escrow: acq.escrow,
        wrappedMint: opts.source.mint,
        userWrappedAta: userWrapped,
        mintAuthority: acq.mintAuthority,
        wrappedProgram: opts.wrappedProgram,
        userUnderlyingAta: userUnderlying,
        owner: owner,
        underlyingMint: opts.source.underlying,
        underlyingProgram: opts.source.underlyingProgram || Sol.TOKEN_PROGRAM,
        depositRaw: depositRaw,
        bump: bump,
        rentPayer: owner
      });
      var bytes = Sol.compileLegacyMessage(owner, blockhash, ixs);
      return {
        transaction: OpenZooCrypto.bytesToBase64(bytes),
        userWrapped: userWrapped,
        userUnderlying: userUnderlying,
        depositRaw: depositRaw,
        bump: bump
      };
    });
  }

  var api = {
    WRAP_PROGRAM: WRAP_PROGRAM,
    MINIMUM_LIQUIDITY: MINIMUM_LIQUIDITY,
    depositForShares: depositForShares,
    wrapAccountKeys: wrapAccountKeys,
    wrapIxData: wrapIxData,
    buildWrapInstruction: buildWrapInstruction,
    buildWrapInstructions: buildWrapInstructions,
    pickLargestUseful: pickLargestUseful,
    holdingsMap: holdingsMap,
    resolveWrapPlan: resolveWrapPlan,
    chooseEzTopup: chooseEzTopup,
    mintOwnerProgram: mintOwnerProgram,
    buildUnsignedWrapTx: buildUnsignedWrapTx
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooWrap = api;
})(typeof window !== 'undefined' ? window : globalThis);
