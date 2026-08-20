/* Claude CLI / openzoo proxy spill path, for iOS chat.
 *
 * Never POST the growing thread AND set X-HRR-Context — that combo is what
 * made grokui skip spill (850k chars forwarded, no bind). Match Claude CLI:
 * bind the prefix on the gateway, keep one context id per thread, later
 * turns send system + a short tail + that id so the gateway can APPEND.
 */
(function (root) {
  'use strict';

  var KEEP_TAIL = 3;
  var SYSTEM = 'You are OpenZoo. Be useful and concise. The user may have attached files for this chat; use that material when it helps. Do not mention payment rails, bind endpoints, or context ids.';
  var HUD_KEY = 'openzoo.ios.hud.v1';

  function conversationTurns(messages) {
    return (messages || []).filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant');
    }).map(function (m) {
      return { role: m.role, content: m.content };
    });
  }

  function splitPrefixTail(turns, keepTail) {
    var keep = Number(keepTail);
    if (!Number.isFinite(keep) || keep < 1) keep = KEEP_TAIL;
    var list = Array.isArray(turns) ? turns : [];
    if (list.length <= keep) {
      return { prefix: [], tail: list.slice(), shouldBind: false };
    }
    return {
      prefix: list.slice(0, list.length - keep),
      tail: list.slice(-keep),
      shouldBind: true
    };
  }

  function prefixCorpus(turns) {
    return (turns || []).map(function (m) {
      return String(m.role || 'user') + ': ' + String(m.content || '');
    }).join('\n\n');
  }

  function headerContext(headers) {
    if (!headers) return '';
    return headers['X-HRR-Context'] || headers['x-hrr-context'] || '';
  }

  function isSkipSpillCombo(headers, outgoing, allTurns) {
    if (!headerContext(headers)) return false;
    var sent = conversationTurns(outgoing);
    var full = Array.isArray(allTurns) ? conversationTurns(allTurns) : sent;
    if (full.length <= KEEP_TAIL) return false;
    return sent.length >= full.length;
  }

  function buildChatRequest(opts) {
    opts = opts || {};
    var model = opts.model || 'openai/gpt-4o-mini';
    var system = opts.system || SYSTEM;
    var turns = conversationTurns(opts.turns || opts.messages || []);
    var contextId = opts.contextId || null;
    var split = splitPrefixTail(turns, opts.keepTail);
    var sys = { role: 'system', content: system };
    var headers = {};
    var messages;
    var mode;

    if (contextId) {
      messages = [sys].concat(split.tail);
      headers['X-HRR-Context'] = contextId;
      mode = 'tail';
    } else {
      messages = [sys].concat(turns);
      mode = 'full';
    }

    if (isSkipSpillCombo(headers, messages, turns)) {
      messages = [sys].concat(split.tail);
      mode = 'tail';
    }

    return {
      body: { model: model, messages: messages },
      headers: headers,
      mode: mode,
      sent: conversationTurns(messages).length,
      total: turns.length,
      prefix: split.prefix,
      tail: split.tail,
      shouldBind: split.shouldBind,
      contextId: contextId
    };
  }

  function captureContextId(out) {
    if (!out) return null;
    var data = out.data;
    if (data && typeof data === 'object') {
      if (data.context_id) return data.context_id;
      if (data.x402 && data.x402.context_id) return data.x402.context_id;
      if (data.lecore && data.lecore.context_id) return data.lecore.context_id;
      if (data.extra && data.extra.context_id) return data.extra.context_id;
    }
    var headers = out.headers || (out.res && out.res.headers);
    if (headers) {
      var get = typeof headers.get === 'function'
        ? function (k) { return headers.get(k); }
        : function (k) { return headers[k] || headers[k.toLowerCase()]; };
      var fromHeader = get('x-hrr-context') || get('X-HRR-Context');
      if (fromHeader) return fromHeader;
    }
    return null;
  }

  function extractX402(data, accepts) {
    if (data && data.x402 && typeof data.x402 === 'object') return data.x402;
    var row = Array.isArray(accepts) && accepts.length ? accepts[0] : null;
    return (row && row.extra) || null;
  }

  function emptyHud() {
    return { spentUsd: 0, directUsd: 0, paidCalls: 0 };
  }

  function loadHud(storage) {
    var store = storage;
    if (!store) {
      try { store = typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { store = null; }
    }
    if (!store) return emptyHud();
    try {
      var raw = store.getItem(HUD_KEY);
      if (!raw) return emptyHud();
      var parsed = JSON.parse(raw);
      return {
        spentUsd: Number(parsed.spentUsd) || 0,
        directUsd: Number(parsed.directUsd) || 0,
        paidCalls: Number(parsed.paidCalls) || 0
      };
    } catch (_) {
      return emptyHud();
    }
  }

  function saveHud(stats, storage) {
    var store = storage;
    if (!store) {
      try { store = typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { store = null; }
    }
    if (!store) return false;
    try {
      store.setItem(HUD_KEY, JSON.stringify({
        spentUsd: stats.spentUsd,
        directUsd: stats.directUsd,
        paidCalls: stats.paidCalls
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function noteHudReceipt(stats, rec) {
    var next = stats && typeof stats === 'object' ? stats : emptyHud();
    if (!rec || typeof rec !== 'object') return next;
    var billed = Number(rec.billedUsd);
    if (!Number.isFinite(billed) || billed < 0) return next;
    next.spentUsd += billed;
    next.paidCalls += 1;
    if (typeof rec.directUsd === 'number' && Number.isFinite(rec.directUsd)) {
      next.directUsd += rec.directUsd;
    } else if (typeof rec.savesVsDirect === 'number' && Number.isFinite(rec.savesVsDirect)) {
      next.directUsd += rec.savesVsDirect * billed;
    } else {
      next.directUsd += billed;
    }
    return next;
  }

  function hudSavingX(stats) {
    var spent = Number(stats && stats.spentUsd);
    var direct = Number(stats && stats.directUsd);
    if (!(spent > 0) || !Number.isFinite(direct)) return null;
    return direct / spent;
  }

  function formatSavingX(x) {
    if (x == null || !Number.isFinite(x)) return '—';
    if (x >= 100) return Math.round(x) + 'x';
    if (x >= 10) return x.toFixed(1) + 'x';
    return x.toFixed(2) + 'x';
  }

  var api = {
    KEEP_TAIL: KEEP_TAIL,
    SYSTEM: SYSTEM,
    HUD_KEY: HUD_KEY,
    conversationTurns: conversationTurns,
    splitPrefixTail: splitPrefixTail,
    prefixCorpus: prefixCorpus,
    headerContext: headerContext,
    isSkipSpillCombo: isSkipSpillCombo,
    buildChatRequest: buildChatRequest,
    captureContextId: captureContextId,
    extractX402: extractX402,
    emptyHud: emptyHud,
    loadHud: loadHud,
    saveHud: saveHud,
    noteHudReceipt: noteHudReceipt,
    hudSavingX: hudSavingX,
    formatSavingX: formatSavingX
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooChatSpill = api;
})(typeof window !== 'undefined' ? window : globalThis);
