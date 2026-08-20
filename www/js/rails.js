/* Live x402 rail directory. Never hardcode a stale twin allowlist. */
(function (root) {
  'use strict';

  var SUPPORTED_URL = 'https://x402.accrue.fund/supported';
  var SOLANA_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  var DRAINED_MINT = 'Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9';
  var CACHE_MS = 5 * 60 * 1000;

  var cache = { at: 0, kinds: null };

  function isDrainedMint(mint) {
    return String(mint || '') === DRAINED_MINT;
  }

  function extraOf(kind) {
    return (kind && kind.extra) || {};
  }

  function kindAsset(kind) {
    return extraOf(kind).asset || kind.asset || '';
  }

  function isSolanaExact(kind) {
    if (!kind || kind.scheme !== 'exact') return false;
    return kind.network === SOLANA_NETWORK;
  }

  function parseSupported(body) {
    var kinds = (body && Array.isArray(body.kinds)) ? body.kinds : [];
    var rails = {};
    kinds.forEach(function (kind) {
      if (!isSolanaExact(kind)) return;
      var extra = extraOf(kind);
      var mint = kindAsset(kind);
      if (!mint || isDrainedMint(mint)) return;
      rails[mint] = {
        mint: mint,
        symbol: extra.symbol || mint,
        decimals: extra.decimals != null ? extra.decimals : 0,
        yieldBearing: !!extra.yieldBearing,
        feePayer: extra.feePayer || null,
        acquire: extra.acquire || null,
        warning: extra.warning || '',
        kind: kind
      };
    });
    return { kinds: kinds, rails: rails };
  }

  function directoryRail(parsed, mint) {
    if (!parsed || !parsed.rails) return null;
    return parsed.rails[mint] || null;
  }

  function acceptAsset(row) {
    return (row && (row.asset || (row.extra && row.extra.asset))) || '';
  }

  function acceptSymbol(row, parsed) {
    if (row && row.extra && row.extra.symbol) return row.extra.symbol;
    var rail = directoryRail(parsed, acceptAsset(row));
    return (rail && rail.symbol) || acceptAsset(row);
  }

  function acceptDecimals(row, parsed) {
    if (row && row.extra && row.extra.decimals != null) return row.extra.decimals;
    var rail = directoryRail(parsed, acceptAsset(row));
    return (rail && rail.decimals) || 0;
  }

  function isDeprecatedAccept(row) {
    return isDrainedMint(acceptAsset(row));
  }

  function isLiveSolanaAccept(row, parsed) {
    if (!row || row.scheme && row.scheme !== 'exact') return false;
    if (row.network !== SOLANA_NETWORK) return false;
    var mint = acceptAsset(row);
    if (!mint || isDrainedMint(mint)) return false;
    if (!parsed || !parsed.rails) return false;
    return !!parsed.rails[mint];
  }

  function liveAccepts(accepts, parsed) {
    return (accepts || []).filter(function (row) {
      return isLiveSolanaAccept(row, parsed);
    });
  }

  function deprecatedAccepts(accepts) {
    return (accepts || []).filter(isDeprecatedAccept);
  }

  function wrapSource(parsed, mint) {
    var rail = directoryRail(parsed, mint);
    var acq = rail && rail.acquire;
    if (!acq || acq.method !== 'spl-token-wrap') return null;
    var under = acq.underlying || {};
    if (!under.address) return null;
    return {
      mint: mint,
      symbol: rail.symbol,
      decimals: rail.decimals,
      acquire: acq,
      underlying: under.address,
      underlyingSymbol: under.symbol || 'token',
      underlyingDecimals: under.decimals != null ? under.decimals : 6,
      underlyingProgram: under.tokenProgram || null,
      escrow: acq.escrow,
      mintAuthority: acq.mintAuthority,
      authorityBump: acq.authorityBump,
      program: acq.program
    };
  }

  function loadSupported(fetchImpl, now) {
    now = now || Date.now();
    if (cache.kinds && now - cache.at < CACHE_MS) {
      return Promise.resolve(parseSupported({ kinds: cache.kinds }));
    }
    var fetchFn = fetchImpl || (root.OpenZooHttp && root.OpenZooHttp.request) || root.fetch;
    return fetchFn(SUPPORTED_URL, { method: 'GET' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load payment options');
      return res.json();
    }).then(function (body) {
      if (!body || !Array.isArray(body.kinds)) throw new Error('Could not load payment options');
      cache = { at: now, kinds: body.kinds };
      return parseSupported(body);
    });
  }

  function resetCache() {
    cache = { at: 0, kinds: null };
  }

  var api = {
    SUPPORTED_URL: SUPPORTED_URL,
    SOLANA_NETWORK: SOLANA_NETWORK,
    DRAINED_MINT: DRAINED_MINT,
    CACHE_MS: CACHE_MS,
    isDrainedMint: isDrainedMint,
    parseSupported: parseSupported,
    directoryRail: directoryRail,
    acceptAsset: acceptAsset,
    acceptSymbol: acceptSymbol,
    acceptDecimals: acceptDecimals,
    isDeprecatedAccept: isDeprecatedAccept,
    isLiveSolanaAccept: isLiveSolanaAccept,
    liveAccepts: liveAccepts,
    deprecatedAccepts: deprecatedAccepts,
    wrapSource: wrapSource,
    loadSupported: loadSupported,
    resetCache: resetCache
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooRails = api;
})(typeof window !== 'undefined' ? window : globalThis);
