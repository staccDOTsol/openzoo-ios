/* Zoo subscription catalog + App Store key exchange. One billing system. */
(function (root) {
  'use strict';

  var BILLING_BASE = 'https://zoo.openzoo.fun';
  var TIERS_URL = BILLING_BASE + '/api/billing/tiers';
  // TODO(site): zoo.openzoo.fun already bills through Stripe
  // (POST /api/billing/checkout → checkout.stripe.com, GET /api/billing/key
  // behind a cookie session). There is no App Store verify route yet.
  // Add POST /api/billing/appstore on that same billing service: verify the
  // StoreKit 2 JWS and mint the same subscription key Stripe checkout would.
  // Do not invent a second catalog, Stripe product, or key format.
  var APPSTORE_URL = BILLING_BASE + '/api/billing/appstore';

  var PRODUCT_IDS = {
    basic: 'fun.openzoo.ios.sub.basic',
    pro: 'fun.openzoo.ios.sub.pro',
    ultra: 'fun.openzoo.ios.sub.ultra'
  };
  var HIGHLIGHT_TIER = 'pro';
  var TAGLINE = 'Subscription keys · no x402';
  var CLOSE = 'No x402, no wallet, no per-call signing.';

  // Copied from the live GET /api/billing/tiers body on 2026-08-20. Used only
  // when the catalog is unreachable — do not invent other prices.
  var FALLBACK_CATALOG = {
    ok: true,
    trialDays: 0,
    trialReason: 'runway_floor',
    usageThresholdCents: 100,
    note: 'Usage is billed at our upstream cost with no markup. It is invoiced whenever accrued usage reaches $1.00, not at month end.',
    tiers: [
      {
        id: 'basic',
        name: 'Basic',
        monthlyCents: 900,
        savingsSharePct: 40,
        rpm: 60,
        maxBindBytes: 33554432,
        maxTopK: 32,
        blurb: 'One vault, one machine.'
      },
      {
        id: 'pro',
        name: 'Pro',
        monthlyCents: 2900,
        savingsSharePct: 20,
        rpm: 300,
        maxBindBytes: 536870912,
        maxTopK: 128,
        blurb: 'A whole archive, and the breadth to actually read it.'
      },
      {
        id: 'ultra',
        name: 'Ultra',
        monthlyCents: 9900,
        savingsSharePct: 10,
        rpm: 2000,
        maxBindBytes: 8589934592,
        maxTopK: 256,
        blurb: 'Agents, fleets, and corpora that do not fit anywhere else.'
      }
    ]
  };

  function productIdForTier(tierId) {
    return PRODUCT_IDS[tierId] || null;
  }

  function tierIdForProduct(productId) {
    var ids = Object.keys(PRODUCT_IDS);
    for (var i = 0; i < ids.length; i++) {
      if (PRODUCT_IDS[ids[i]] === productId) return ids[i];
    }
    return null;
  }

  function dollars(cents) {
    return '$' + (Number(cents) / 100).toFixed(0);
  }

  function bindLabel(bytes) {
    var n = Number(bytes) || 0;
    if (n >= 1073741824) return '~' + Math.round(n / 1073741824) + 'GB';
    if (n >= 1048576) return Math.round(n / 1048576) + 'MB';
    return n + 'B';
  }

  function normalizeCatalog(body) {
    var src = (body && Array.isArray(body.tiers) && body.tiers.length) ? body : FALLBACK_CATALOG;
    var tiers = src.tiers.map(function (t) {
      return {
        id: t.id,
        name: t.name,
        monthlyCents: t.monthlyCents,
        priceLabel: dollars(t.monthlyCents) + '/mo',
        savingsSharePct: t.savingsSharePct,
        rpm: t.rpm,
        maxBindBytes: t.maxBindBytes,
        maxBindLabel: bindLabel(t.maxBindBytes),
        maxTopK: t.maxTopK,
        blurb: t.blurb || '',
        productId: productIdForTier(t.id),
        highlight: t.id === HIGHLIGHT_TIER,
        highlightLabel: t.id === HIGHLIGHT_TIER ? 'Most teams want this' : ''
      };
    }).filter(function (t) { return !!t.productId; });
    return {
      tiers: tiers,
      trialDays: src.trialDays != null ? src.trialDays : 0,
      trialReason: src.trialReason || '',
      usageThresholdCents: src.usageThresholdCents != null ? src.usageThresholdCents : 100,
      note: src.note || FALLBACK_CATALOG.note,
      tagline: TAGLINE,
      close: CLOSE
    };
  }

  function loadTiers(fetchImpl) {
    var fetchFn = fetchImpl || root.fetch;
    return fetchFn(TIERS_URL, { method: 'GET' }).then(function (res) {
      if (!res.ok) throw new Error('tiers ' + res.status);
      return res.json();
    }).then(normalizeCatalog).catch(function () {
      return normalizeCatalog(FALLBACK_CATALOG);
    });
  }

  function exchangeAppStore(payload, fetchImpl) {
    var fetchFn = fetchImpl || root.fetch;
    return fetchFn(APPSTORE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedTransaction: payload.jws || payload.signedTransaction,
        productId: payload.productId,
        tier: payload.tier || tierIdForProduct(payload.productId),
        originalTransactionId: payload.originalTransactionId || null
      })
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (_) { data = null; }
        }
        if (res.status === 404 || (typeof text === 'string' && text.indexOf('<!DOCTYPE') === 0)) {
          return {
            ok: false,
            pending: true,
            todo: 'POST /api/billing/appstore',
            endpoint: APPSTORE_URL,
            error: 'App Store key exchange is not on the zoo yet. Your purchase is saved; we will retry.'
          };
        }
        if (!res.ok || !data || !data.ok) {
          return {
            ok: false,
            pending: true,
            todo: 'POST /api/billing/appstore',
            endpoint: APPSTORE_URL,
            error: (data && (data.error || data.message)) || ('Key exchange failed (' + res.status + ')')
          };
        }
        return {
          ok: true,
          key: data.key || data.apiKey || data.token || '',
          tier: data.tier || payload.tier
        };
      });
    }).catch(function (err) {
      return {
        ok: false,
        pending: true,
        todo: 'POST /api/billing/appstore',
        endpoint: APPSTORE_URL,
        error: err.message || String(err)
      };
    });
  }

  var api = {
    BILLING_BASE: BILLING_BASE,
    TIERS_URL: TIERS_URL,
    APPSTORE_URL: APPSTORE_URL,
    PRODUCT_IDS: PRODUCT_IDS,
    HIGHLIGHT_TIER: HIGHLIGHT_TIER,
    TAGLINE: TAGLINE,
    CLOSE: CLOSE,
    FALLBACK_CATALOG: FALLBACK_CATALOG,
    productIdForTier: productIdForTier,
    tierIdForProduct: tierIdForProduct,
    normalizeCatalog: normalizeCatalog,
    loadTiers: loadTiers,
    exchangeAppStore: exchangeAppStore
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooBilling = api;
})(typeof window !== 'undefined' ? window : globalThis);
