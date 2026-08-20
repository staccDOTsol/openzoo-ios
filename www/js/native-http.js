/* HTTPS from the Cordova shell. WKWebView fetch from app://localhost dies as TypeError: Load failed. */
(function (root) {
  'use strict';

  function plugin() {
    if (root.OpenZooWallet && typeof root.OpenZooWallet.httpRequest === 'function') {
      return root.OpenZooWallet;
    }
    try {
      if (root.parent && root.parent !== root && root.parent.OpenZooWallet) {
        return root.parent.OpenZooWallet;
      }
    } catch (_) {}
    return null;
  }

  function asResponse(result) {
    var status = result && result.status != null ? Number(result.status) : 0;
    var text = result && result.text != null ? String(result.text) : '';
    return {
      ok: status >= 200 && status < 300,
      status: status,
      text: function () { return Promise.resolve(text); },
      json: function () {
        if (!text) return Promise.resolve(null);
        try { return Promise.resolve(JSON.parse(text)); } catch (err) {
          return Promise.reject(err);
        }
      }
    };
  }

  function request(url, opts) {
    opts = opts || {};
    var body = opts.body;
    if (body && typeof body !== 'string') {
      try { body = JSON.stringify(body); } catch (_) { body = String(body); }
    }
    var native = plugin();
    if (native && typeof native.httpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        native.httpRequest(url, {
          method: opts.method || 'GET',
          headers: opts.headers || {},
          body: body || null
        }, function (result) {
          resolve(asResponse(result));
        }, function (err) {
          var msg = err || 'network error';
          if (root.OpenZooUserErrors && typeof root.OpenZooUserErrors.sanitize === 'function') {
            reject(new Error(root.OpenZooUserErrors.sanitize(msg)));
            return;
          }
          reject(new Error(String(msg)));
        });
      });
    }
    var fetchFn = opts.fetch || root.fetch;
    if (!fetchFn) return Promise.reject(new Error('The zoo could not reach the network. Try again.'));
    return fetchFn(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: body || undefined
    });
  }

  var api = { plugin: plugin, request: request, asResponse: asResponse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooHttp = api;
})(typeof window !== 'undefined' ? window : globalThis);
