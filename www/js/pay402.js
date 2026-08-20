/* Persist a 402 across the wallet round-trip. App backgrounds; in-flight fetch dies. */
(function (root) {
  'use strict';

  var KEY = 'openzoo.ios.pay402.v1';
  var MAX_AGE_MS = 10 * 60 * 1000;

  function storageOf(storage) {
    if (storage) return storage;
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
  }

  function persist(state, storage) {
    var store = storageOf(storage);
    if (!store) return false;
    try {
      store.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      return false;
    }
  }

  function load(storage) {
    var store = storageOf(storage);
    if (!store) return null;
    try {
      var raw = store.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clear(storage) {
    var store = storageOf(storage);
    if (!store) return;
    try { store.removeItem(KEY); } catch (_) {}
  }

  function shouldRetryAfterResume(state, opts) {
    opts = opts || {};
    var now = opts.now != null ? opts.now : Date.now();
    if (!state || !Array.isArray(state.accepts) || !state.accepts.length) return false;
    if (!state.userText) return false;
    if (state.terminal) return false;
    if (opts.hasPendingSign) return false;
    if (opts.settleInFlight) return false;
    if (state.at && now - state.at > MAX_AGE_MS) return false;
    if (opts.threadId && state.threadId && opts.threadId !== state.threadId) return false;
    if (opts.requireWallet && !opts.walletAddress) return false;
    return true;
  }

  var api = {
    KEY: KEY,
    MAX_AGE_MS: MAX_AGE_MS,
    persist: persist,
    load: load,
    clear: clear,
    shouldRetryAfterResume: shouldRetryAfterResume
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooPay402 = api;
})(typeof window !== 'undefined' ? window : globalThis);
