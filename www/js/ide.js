/* Cloud code-server + Cline for iOS Agent. Desktop grokui can run a local
 * PTY; this app cannot. Agent asks the zoo door for an IDE session and
 * loads that URL in the existing webview / InAppBrowser. Same subscription
 * Bearer Chat already uses. Never ANTHROPIC_API_KEY. Never an open URL.
 *
 *   POST /ide/session  {} → { url, password?, id }
 *   GET  /ide/session      → same if a session is already running
 *
 * Hosted OCC /occ/sessions stays in the tree unused. Do not invent /api/occ.
 */
(function (root) {
  'use strict';

  var IDE_ORIGIN = 'https://zoo.openzoo.fun';
  var IDE_PATH = '/ide/session';
  var NO_KEY = 'IDE_NO_KEY';
  var MISSING = 'IDE_MISSING';
  var REFUSED = 'IDE_REFUSED';
  var OPEN_URL = 'IDE_OPEN_URL';
  var NOT_LIVE = 'cloud Agent not live yet';

  function trimKey(key) {
    return String(key || '').trim();
  }

  function requireKey(key) {
    var k = trimKey(key);
    if (!k) {
      var err = new Error('A subscription key is required for Agent.');
      err.code = NO_KEY;
      throw err;
    }
    return k;
  }

  function canAgent(key) {
    return !!trimKey(key);
  }

  function authHeaders(key, extra) {
    var k = requireKey(key);
    var headers = Object.assign({
      Authorization: 'Bearer ' + k
    }, extra || {});
    delete headers.ANTHROPIC_API_KEY;
    delete headers.anthropic_api_key;
    delete headers['x-api-key'];
    delete headers['X-Api-Key'];
    delete headers['X-API-Key'];
    return headers;
  }

  function ideUrl(path) {
    var p = path == null ? IDE_PATH : path;
    if (/^https?:\/\//i.test(p)) {
      var err = new Error('IDE calls must stay on the zoo origin.');
      err.code = OPEN_URL;
      throw err;
    }
    return IDE_ORIGIN + (String(p).charAt(0) === '/' ? p : '/' + p);
  }

  function isHtmlBody(text) {
    return typeof text === 'string' && /^\s*<!DOCTYPE/i.test(text);
  }

  function hostAllowed(host) {
    var h = String(host || '').toLowerCase();
    return h === 'zoo.openzoo.fun' || h.slice(-12) === '.openzoo.fun';
  }

  function assertSessionUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) {
      var missing = new Error(NOT_LIVE);
      missing.code = MISSING;
      throw missing;
    }
    if (/^(javascript|data|blob|about|file):/i.test(value)) {
      var open = new Error('Agent refused an open URL.');
      open.code = OPEN_URL;
      throw open;
    }
    if (value.charAt(0) === '/') {
      return IDE_ORIGIN + value;
    }
    var parsed;
    try {
      parsed = new URL(value);
    } catch (_) {
      var bad = new Error('Agent refused an open URL.');
      bad.code = OPEN_URL;
      throw bad;
    }
    if (parsed.protocol !== 'https:' || !hostAllowed(parsed.hostname)) {
      var refused = new Error('Agent refused an open URL.');
      refused.code = OPEN_URL;
      throw refused;
    }
    return parsed.toString();
  }

  function sessionOf(data) {
    if (!data || typeof data !== 'object') return null;
    var url = data.url || data.href || data.ideUrl;
    if (!url) return null;
    return {
      url: assertSessionUrl(url),
      password: data.password != null ? String(data.password) : (data.pass != null ? String(data.pass) : ''),
      id: String(data.id || data.session_id || data.sessionId || '').trim()
    };
  }

  function classifyHttp(res, text, data) {
    var status = res && res.status;
    if (status === 401 || status === 403) {
      var refused = new Error('This subscription key was refused. Open Plan to restore or subscribe.');
      refused.code = REFUSED;
      refused.status = status;
      return refused;
    }
    if (status === 402) {
      var pay = new Error('Agent is on a subscription key. The zoo asked for a per-call payment anyway — we did not open a wallet.');
      pay.code = 'IDE_402';
      pay.status = 402;
      return pay;
    }
    if (status === 404 && isHtmlBody(text)) {
      var missing = new Error(NOT_LIVE);
      missing.code = MISSING;
      missing.status = 404;
      missing.html = true;
      return missing;
    }
    if (status === 404) {
      var idle = new Error('No cloud Agent session is running.');
      idle.code = 'IDE_IDLE';
      idle.status = 404;
      return idle;
    }
    var msg = (data && (data.error || data.message)) || (typeof text === 'string' && !isHtmlBody(text) && text) || ('HTTP ' + status);
    var err = new Error(String(msg));
    err.status = status;
    return err;
  }

  function parseJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function request(key, path, options, fetchImpl) {
    var fetchFn = fetchImpl || root.fetch;
    options = options || {};
    var headers;
    try {
      headers = authHeaders(key, options.headers || {});
    } catch (err) {
      return Promise.reject(err);
    }
    var init = {
      method: options.method || 'GET',
      headers: headers
    };
    if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        init.body = options.body;
      } else {
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        init.body = JSON.stringify(options.body);
      }
    }
    return fetchFn(ideUrl(path), init).then(function (res) {
      return res.text().then(function (text) {
        var data = parseJson(text);
        if (!res.ok) throw classifyHttp(res, text, data);
        if (isHtmlBody(text)) {
          var html = new Error(NOT_LIVE);
          html.code = MISSING;
          html.status = res.status;
          html.html = true;
          throw html;
        }
        return { res: res, data: data, text: text };
      });
    });
  }

  function getSession(key, fetchImpl) {
    return request(key, IDE_PATH, { method: 'GET' }, fetchImpl).then(function (out) {
      var session = sessionOf(out.data);
      if (!session) {
        var idle = new Error('No cloud Agent session is running.');
        idle.code = 'IDE_IDLE';
        throw idle;
      }
      return session;
    });
  }

  function createSession(key, fetchImpl) {
    return request(key, IDE_PATH, { method: 'POST', body: {} }, fetchImpl).then(function (out) {
      var session = sessionOf(out.data);
      if (!session) {
        var err = new Error(NOT_LIVE);
        err.code = MISSING;
        throw err;
      }
      return session;
    });
  }

  function openSession(key, fetchImpl) {
    return getSession(key, fetchImpl).catch(function (err) {
      if (err && err.code === REFUSED) throw err;
      if (err && err.code === NO_KEY) throw err;
      if (err && err.code === OPEN_URL) throw err;
      if (err && err.code === MISSING && err.html) throw err;
      if (err && err.code === 'IDE_402') throw err;
      return createSession(key, fetchImpl);
    });
  }

  function inAppBrowser() {
    return root.cordova && root.cordova.InAppBrowser && typeof root.cordova.InAppBrowser.open === 'function'
      ? root.cordova.InAppBrowser
      : null;
  }

  function loadSession(session, opts) {
    opts = opts || {};
    var url = assertSessionUrl(session && session.url);
    var browser = inAppBrowser();
    if (browser) {
      var ref = browser.open(url, '_blank', opts.features || 'location=no,toolbar=yes,toolbarposition=top,closebuttoncaption=Chat');
      return { url: url, password: session.password || '', id: session.id || '', target: 'inappbrowser', ref: ref };
    }
    var frame = opts.frame || (typeof document !== 'undefined' && document.getElementById('agentFrame'));
    if (frame) {
      frame.src = url;
      return { url: url, password: session.password || '', id: session.id || '', target: 'iframe', frame: frame };
    }
    var noView = new Error(NOT_LIVE);
    noView.code = MISSING;
    throw noView;
  }

  var api = {
    IDE_ORIGIN: IDE_ORIGIN,
    IDE_PATH: IDE_PATH,
    NO_KEY: NO_KEY,
    MISSING: MISSING,
    REFUSED: REFUSED,
    OPEN_URL: OPEN_URL,
    NOT_LIVE: NOT_LIVE,
    canAgent: canAgent,
    requireKey: requireKey,
    authHeaders: authHeaders,
    ideUrl: ideUrl,
    assertSessionUrl: assertSessionUrl,
    sessionOf: sessionOf,
    getSession: getSession,
    createSession: createSession,
    openSession: openSession,
    loadSession: loadSession
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooIde = api;
})(typeof window !== 'undefined' ? window : globalThis);
