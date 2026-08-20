/* StoreKit 2 wrapper. Never opens Stripe checkout. */
(function (root) {
  'use strict';

  var SUB_KEY = 'subscription';
  var API_SECRET = 'subscriptionApiKey';

  function pluginReady() {
    return !!(root.OpenZooStore && typeof root.OpenZooStore.purchase === 'function');
  }

  function lsGet(k) {
    try { return localStorage.getItem('openzoo.' + k); } catch (_) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem('openzoo.' + k, v); } catch (_) {}
  }
  function lsDel(k) {
    try { localStorage.removeItem('openzoo.' + k); } catch (_) {}
  }

  function noArgMethods() {
    return {
      restore: true,
      entitlements: true,
      debugBuild: true,
      debugUnlockStatus: true
    };
  }

  function call(method, arg) {
    return new Promise(function (resolve, reject) {
      if (!pluginReady()) {
        reject(new Error('App Store purchases need the iOS app.'));
        return;
      }
      var fn = root.OpenZooStore[method];
      if (typeof fn !== 'function') {
        reject(new Error('StoreKit failed'));
        return;
      }
      if (noArgMethods()[method]) {
        fn(function (value) { resolve(value); }, function (err) { reject(new Error(err || 'StoreKit failed')); });
        return;
      }
      fn(arg, function (value) { resolve(value); }, function (err) { reject(new Error(err || 'StoreKit failed')); });
    });
  }

  function loadSubscription() {
    var raw = lsGet(SUB_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function saveSubscription(sub) {
    lsSet(SUB_KEY, JSON.stringify(sub));
    if (sub && sub.key && pluginKeychain()) {
      storeSecret(API_SECRET, sub.key);
    } else if (sub && sub.key) {
      lsSet(API_SECRET, sub.key);
    }
  }

  function pluginKeychain() {
    return !!(root.OpenZooWallet && typeof root.OpenZooWallet.storeSecret === 'function');
  }

  function storeSecret(key, value) {
    return new Promise(function (resolve) {
      if (pluginKeychain()) {
        root.OpenZooWallet.storeSecret(key, value, function () { resolve(); }, function () { resolve(); });
        return;
      }
      lsSet(key, value);
      resolve();
    });
  }

  function loadSecret(key) {
    return new Promise(function (resolve) {
      if (pluginKeychain()) {
        root.OpenZooWallet.loadSecret(key, function (value) { resolve(value || ''); }, function () { resolve(lsGet(key) || ''); });
        return;
      }
      resolve(lsGet(key) || '');
    });
  }

  function clearSubscription() {
    lsDel(SUB_KEY);
    lsDel(API_SECRET);
    if (pluginKeychain()) {
      root.OpenZooWallet.deleteSecret(API_SECRET, function () {}, function () {});
    }
  }

  function hasAccess(sub, opts) {
    if (!sub) return false;
    if (sub.productId || sub.jws || sub.key) return true;
    return !!(opts && opts.debug && sub.localUnlock);
  }

  function applyLocalUnlock(sub) {
    var next = sub && typeof sub === 'object' ? Object.assign({}, sub) : {};
    next.localUnlock = true;
    next.tier = next.tier || 'dev';
    next.updatedAt = Date.now();
    return next;
  }

  var api = {
    pluginReady: pluginReady,
    products: function (ids) { return call('products', ids); },
    purchase: function (productId) { return call('purchase', productId); },
    restore: function () { return call('restore'); },
    entitlements: function () { return call('entitlements'); },
    debugBuild: function () { return call('debugBuild'); },
    debugUnlock: function (email) { return call('debugUnlock', email); },
    debugUnlockStatus: function () { return call('debugUnlockStatus'); },
    loadSubscription: loadSubscription,
    saveSubscription: saveSubscription,
    clearSubscription: clearSubscription,
    loadSecret: loadSecret,
    storeSecret: storeSecret,
    hasAccess: hasAccess,
    applyLocalUnlock: applyLocalUnlock
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooIOSStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
