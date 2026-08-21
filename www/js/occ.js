/* Hosted OCC for iOS Agent. Desktop grokui runs openzoo-claude on a local
 * PTY; this app cannot. Agent talks to the zoo OCC door with the same
 * subscription Bearer Chat already uses. Never ANTHROPIC_API_KEY. Never an
 * unauthenticated OCC URL.
 *
 * Assumed routes (zoo.openzoo.fun — same origin as /api/billing/tiers).
 * Hosted OCC was not on the live site when this client shipped; align the
 * server to these paths or change OCC_PATHS here:
 *   POST /occ/sessions
 *   POST /occ/sessions/:id/messages   (SSE)
 *   POST /occ/sessions/:id/files
 *   POST /occ/sessions/:id/stop
 */
(function (root) {
  'use strict';

  var OCC_ORIGIN = 'https://zoo.openzoo.fun';
  var OCC_BASE = OCC_ORIGIN + '/occ';
  var NO_KEY = 'OCC_NO_KEY';
  var MISSING = 'OCC_MISSING';
  var REFUSED = 'OCC_REFUSED';

  var OCC_PATHS = {
    sessions: '/occ/sessions',
    messages: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/messages'; },
    files: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/files'; },
    stop: function (id) { return '/occ/sessions/' + encodeURIComponent(id) + '/stop'; }
  };

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

  function occUrl(path) {
    if (!path) return OCC_BASE;
    if (/^https?:\/\//i.test(path)) {
      var err = new Error('OCC URL must stay on the zoo origin.');
      err.code = 'OCC_OPEN_URL';
      throw err;
    }
    return OCC_ORIGIN + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function sessionIdOf(data) {
    if (!data || typeof data !== 'object') return '';
    return String(data.id || data.session_id || data.sessionId || data.occSessionId || '').trim();
  }

  function isHtmlBody(text) {
    return typeof text === 'string' && /^\s*<!DOCTYPE/i.test(text);
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
      pay.code = 'OCC_402';
      pay.status = 402;
      return pay;
    }
    if (status === 404 || isHtmlBody(text)) {
      var missing = new Error('Hosted Agent is not on the zoo yet.');
      missing.code = MISSING;
      missing.status = status || 404;
      return missing;
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

  function stripAnsi(s) {
    return String(s || '')
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b./g, '');
  }

  function decodePty(data) {
    var raw = String(data || '');
    if (!raw) return '';
    if (/^[A-Za-z0-9+/]+=*$/.test(raw.replace(/\s/g, '')) && raw.length % 4 === 0) {
      try {
        if (typeof Buffer !== 'undefined') return Buffer.from(raw, 'base64').toString('utf8');
        if (typeof atob === 'function') {
          var bin = atob(raw);
          var out = '';
          for (var i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i));
          return out;
        }
      } catch (_) { /* treat as plain */ }
    }
    return raw;
  }

  /* OCC stream events, OpenAI-style chat chunks, or a plain string.
   * Not a RUN: parser — we paint whatever the hosted OCC emits. */
  function eventFromPayload(obj) {
    if (obj == null) return null;
    if (typeof obj === 'string') {
      if (obj === '[DONE]') return { type: 'done' };
      return { type: 'delta', text: obj };
    }
    if (typeof obj !== 'object') return null;
    var sid = sessionIdOf(obj);
    var type = String(obj.type || obj.event || '').toLowerCase();
    if (type === 'done' || obj.done === true) return { type: 'done', sessionId: sid };
    if (type === 'error' || obj.error) {
      return {
        type: 'error',
        error: (obj.error && (obj.error.message || obj.error)) || obj.message || 'Agent error',
        sessionId: sid
      };
    }
    if (type === 'status' || obj.status) {
      return { type: 'status', status: String(obj.status || obj.detail || obj.text || ''), sessionId: sid };
    }
    if (type === 'session' || sid) {
      var text = extractText(obj);
      if (type === 'session' && !text) return { type: 'session', sessionId: sid };
      if (text) return { type: 'delta', text: text, sessionId: sid };
      if (type === 'session') return { type: 'session', sessionId: sid };
    }
    var chunk = extractText(obj);
    if (chunk) return { type: 'delta', text: chunk, sessionId: sid, replace: !!obj.replace };
    if (sid) return { type: 'session', sessionId: sid };
    return null;
  }

  function extractText(obj) {
    if (!obj || typeof obj !== 'object') return '';
    if (obj.type === 'pty' || obj.pty) {
      return stripAnsi(decodePty(obj.data || obj.pty || obj.text || ''));
    }
    var choice = obj.choices && obj.choices[0];
    var msg = choice && choice.message;
    var delta = choice && (choice.delta || choice.message);
    var openai = (msg && msg.content) || (delta && delta.content);
    if (openai) return String(openai);
    if (obj.delta != null && typeof obj.delta === 'object' && obj.delta.content) {
      return String(obj.delta.content);
    }
    var raw = obj.text || obj.output || obj.content || obj.delta || obj.chunk;
    if (raw == null) return '';
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw.content) return String(raw.content);
    return '';
  }

  function consumeSse(buf, onEvent) {
    var parts = String(buf || '').split(/\r?\n\r?\n/);
    var rest = parts.pop();
    parts.forEach(function (block) {
      var data = block.split(/\r?\n/).filter(function (line) {
        return /^data:\s*/.test(line);
      }).map(function (line) {
        return line.replace(/^data:\s*/, '');
      }).join('\n');
      if (!data) return;
      if (data === '[DONE]') {
        onEvent({ type: 'done' });
        return;
      }
      var obj = parseJson(data);
      var ev = eventFromPayload(obj != null ? obj : data);
      if (ev) onEvent(ev);
    });
    return rest;
  }

  function readSse(res, onEvent) {
    var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    var buf = '';
    var reply = '';
    var sessionId = '';
    var reader = res.body && res.body.getReader && res.body.getReader();

    function take(ev) {
      if (!ev) return;
      if (ev.sessionId) sessionId = ev.sessionId;
      if (ev.type === 'delta' && ev.text) {
        if (ev.replace) reply = ev.text;
        else reply += ev.text;
      }
      if (onEvent) onEvent(ev);
    }

    if (!reader) {
      return res.text().then(function (text) {
        if (text && /(?:^|\n)data:\s*/.test(text)) {
          consumeSse(text + '\n\n', take);
        } else {
          var data = parseJson(text);
          var ev = eventFromPayload(data != null ? data : text);
          if (ev) take(ev);
          else if (text && !isHtmlBody(text)) {
            reply = stripAnsi(text);
            take({ type: 'delta', text: reply });
          }
        }
        return { reply: reply, sessionId: sessionId, data: null };
      });
    }

    function pump() {
      return reader.read().then(function (part) {
        if (part.done) {
          if (buf) consumeSse(buf + '\n\n', take);
          return { reply: reply, sessionId: sessionId };
        }
        buf += decoder ? decoder.decode(part.value, { stream: true }) : String(part.value || '');
        buf = consumeSse(buf, take);
        return pump();
      });
    }
    return pump();
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
      method: options.method || 'POST',
      headers: headers
    };
    if (options.body !== undefined) {
      if (options.body && typeof options.body === 'object' && typeof FormData !== 'undefined' && options.body instanceof FormData) {
        init.body = options.body;
      } else if (typeof options.body === 'string') {
        init.body = options.body;
      } else {
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        init.body = JSON.stringify(options.body);
      }
    }
    if (options.signal) init.signal = options.signal;
    return fetchFn(occUrl(path), init).then(function (res) {
      var ctype = '';
      try { ctype = String(res.headers.get('content-type') || '').toLowerCase(); } catch (_) {}
      var stream = options.stream && res.ok && ctype.indexOf('application/json') === -1;
      if (stream) {
        return readSse(res, options.onEvent).then(function (out) {
          return { res: res, data: null, text: '', reply: out.reply, sessionId: out.sessionId };
        });
      }
      return res.text().then(function (text) {
        var data = parseJson(text);
        if (res.ok && text && /(?:^|\n)data:\s*/.test(text) && options.stream) {
          var reply = '';
          var sid = '';
          consumeSse(text + '\n\n', function (ev) {
            if (ev.sessionId) sid = ev.sessionId;
            if (ev.type === 'delta' && ev.text) reply += ev.text;
            if (options.onEvent) options.onEvent(ev);
          });
          return { res: res, data: data, text: text, reply: reply, sessionId: sid };
        }
        if (!res.ok) throw classifyHttp(res, text, data);
        var reply = '';
        var ev = eventFromPayload(data);
        if (ev) {
          if (options.onEvent) options.onEvent(ev);
          if (ev.type === 'delta' && ev.text) reply = ev.text;
        } else if (data && (data.text || data.output || data.reply)) {
          reply = String(data.text || data.output || data.reply);
        }
        return { res: res, data: data, text: text, reply: reply, sessionId: sessionIdOf(data) };
      });
    });
  }

  function createSession(key, body, fetchImpl) {
    return request(key, OCC_PATHS.sessions, {
      method: 'POST',
      body: body || {}
    }, fetchImpl).then(function (out) {
      var id = out.sessionId || sessionIdOf(out.data);
      if (!id) {
        var err = new Error('Hosted Agent did not return a session.');
        err.code = MISSING;
        throw err;
      }
      return id;
    });
  }

  function sendMessage(key, sessionId, text, onEvent, opts) {
    opts = opts || {};
    var sid = String(sessionId || '').trim();
    if (!sid) {
      var err = new Error('Agent session missing.');
      err.code = MISSING;
      return Promise.reject(err);
    }
    var payload = {
      text: String(text || ''),
      message: String(text || ''),
      stream: true
    };
    return request(key, OCC_PATHS.messages(sid), {
      method: 'POST',
      body: payload,
      stream: true,
      onEvent: onEvent,
      signal: opts.signal
    }, opts.fetch).then(function (out) {
      return {
        reply: out.reply || '',
        sessionId: out.sessionId || sid
      };
    });
  }

  function bytesOf(item) {
    if (!item) return Promise.resolve(null);
    if (item.bytes) return Promise.resolve(item.bytes);
    if (item.file && typeof item.file.arrayBuffer === 'function') {
      return item.file.arrayBuffer().then(function (buf) { return buf; });
    }
    if (item.arrayBuffer && typeof item.arrayBuffer === 'function') {
      return item.arrayBuffer();
    }
    if (typeof item.content === 'string' && item.encoding === 'base64') {
      if (typeof Buffer !== 'undefined') return Promise.resolve(Buffer.from(item.content, 'base64'));
    }
    if (typeof item.text === 'string') {
      if (typeof TextEncoder !== 'undefined') {
        return Promise.resolve(new TextEncoder().encode(item.text).buffer);
      }
      if (typeof Buffer !== 'undefined') return Promise.resolve(Buffer.from(item.text, 'utf8'));
    }
    if (item.dataUrl && /^data:/i.test(item.dataUrl)) {
      var b64 = String(item.dataUrl).split(',')[1] || '';
      if (typeof Buffer !== 'undefined') return Promise.resolve(Buffer.from(b64, 'base64'));
    }
    return Promise.resolve(null);
  }

  function toBase64(buf) {
    if (!buf) return '';
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString('base64');
    }
    var bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(bin) : '';
  }

  function uploadFile(key, sessionId, item, fetchImpl) {
    var sid = String(sessionId || '').trim();
    if (!sid) {
      var err = new Error('Agent session missing.');
      err.code = MISSING;
      return Promise.reject(err);
    }
    var name = (item && (item.name || (item.file && item.file.name))) || 'file';
    var type = (item && (item.type || (item.file && item.file.type))) || 'application/octet-stream';
    return bytesOf(item).then(function (buf) {
      var body;
      var headers = {};
      if (typeof FormData !== 'undefined' && (item && item.file) && typeof Blob !== 'undefined') {
        body = new FormData();
        body.append('file', item.file, name);
        body.append('name', name);
      } else {
        headers['Content-Type'] = 'application/json';
        body = {
          name: name,
          path: name,
          content: buf ? toBase64(buf) : (item && item.text) || '',
          encoding: buf ? 'base64' : 'utf8',
          contentType: type
        };
      }
      return request(key, OCC_PATHS.files(sid), {
        method: 'POST',
        headers: headers,
        body: body
      }, fetchImpl).then(function (out) {
        var data = out.data || {};
        return {
          name: data.name || data.path || name,
          path: data.path || data.name || name,
          sessionId: out.sessionId || sid
        };
      });
    });
  }

  function stop(key, sessionId, fetchImpl) {
    var sid = String(sessionId || '').trim();
    if (!sid) return Promise.resolve(false);
    return request(key, OCC_PATHS.stop(sid), {
      method: 'POST',
      body: {}
    }, fetchImpl).then(function () { return true; }).catch(function () {
      return false;
    });
  }

  var api = {
    OCC_ORIGIN: OCC_ORIGIN,
    OCC_BASE: OCC_BASE,
    OCC_PATHS: OCC_PATHS,
    NO_KEY: NO_KEY,
    MISSING: MISSING,
    REFUSED: REFUSED,
    canAgent: canAgent,
    requireKey: requireKey,
    authHeaders: authHeaders,
    occUrl: occUrl,
    sessionIdOf: sessionIdOf,
    eventFromPayload: eventFromPayload,
    consumeSse: consumeSse,
    stripAnsi: stripAnsi,
    extractText: extractText,
    createSession: createSession,
    sendMessage: sendMessage,
    uploadFile: uploadFile,
    stop: stop
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooOcc = api;
})(typeof window !== 'undefined' ? window : globalThis);
