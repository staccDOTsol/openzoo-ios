/* Never show WKWebView's raw "Load failed" string to the user. */
(function (root) {
  'use strict';

  function rawMessage(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    return err.message || String(err);
  }

  function isLoadFailed(err) {
    var msg = rawMessage(err);
    return /load failed|failed to fetch|networkerror|the internet connection appears to be offline|notallowederror|aborterror/i.test(msg);
  }

  function sanitize(err) {
    var msg = rawMessage(err).replace(/^typeerror:\s*/i, '');
    if (isLoadFailed(msg) || isLoadFailed(err)) {
      return 'The zoo could not reach the network. Try again.';
    }
    if (/underfund|insufficient|0x1|custom program error/i.test(msg)) {
      return 'This wallet needs a top-up before that message can send.';
    }
    return msg || 'Something went wrong';
  }

  function isRetryable(err) {
    if (isLoadFailed(err)) return true;
    return /could not reach the network/i.test(rawMessage(err));
  }

  var api = {
    rawMessage: rawMessage,
    isLoadFailed: isLoadFailed,
    isRetryable: isRetryable,
    sanitize: sanitize
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooUserErrors = api;
})(typeof window !== 'undefined' ? window : globalThis);
