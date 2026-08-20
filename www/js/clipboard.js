/* Clipboard that works in Cordova WKWebView: native plugin, then execCommand+gesture. */
(function (root) {
  'use strict';

  function execCommandCopy(text, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) return false;
    var ta = doc.createElement('textarea');
    ta.value = String(text == null ? '' : text);
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    doc.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch (_) {}
    var ok = false;
    try { ok = !!doc.execCommand('copy'); } catch (_) { ok = false; }
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    return ok;
  }

  function copyText(text, opts) {
    opts = opts || {};
    var value = String(text == null ? '' : text);
    return new Promise(function (resolve, reject) {
      function fallback() {
        var clip = opts.clipboard;
        if (!clip && root.navigator && root.navigator.clipboard) clip = root.navigator.clipboard;
        if (clip && typeof clip.writeText === 'function') {
          return Promise.resolve(clip.writeText(value)).then(function () { return 'clipboard-api'; });
        }
        if (execCommandCopy(value, opts.document)) return Promise.resolve('execCommand');
        return Promise.reject(new Error('Could not copy'));
      }

      var plugin = opts.plugin;
      if (!plugin) {
        var bridge = root.OpenZooWallet;
        try {
          if ((!bridge || typeof bridge.copyToClipboard !== 'function') && root.parent && root.parent !== root) {
            bridge = root.parent.OpenZooWallet;
          }
        } catch (_) {}
        if (bridge && typeof bridge.copyToClipboard === 'function') {
          plugin = bridge.copyToClipboard.bind(bridge);
        }
      }
      if (typeof plugin === 'function') {
        try {
          plugin(value, function () { resolve('plugin'); }, function () {
            fallback().then(resolve, reject);
          });
          return;
        } catch (_) {
          fallback().then(resolve, reject);
          return;
        }
      }
      fallback().then(resolve, reject);
    });
  }

  var api = { copyText: copyText, execCommandCopy: execCommandCopy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooClipboard = api;
})(typeof window !== 'undefined' ? window : globalThis);
