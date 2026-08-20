/* grokui first-X-of-Y race, for iOS chat.
 *
 * Launch Y models from a tier band. The first X *countable* answers are
 * judged by a cheap classifier. Empty / HTTP / pay / fetch-failed do not
 * count. If nobody clears the bar, ship the last of those X. If X never
 * fills, one race-level failure — never `(name failed: fetch failed)`.
 * Never wait on the slowest. No SPAWN, no worktrees, no podagent.
 */
(function (root) {
  'use strict';

  var RACE_MAX = 4;
  var DEFAULT_N = 4;
  var DEFAULT_NEED = 2;
  var RACE_MIN_SCORE = 6;
  var JUDGE_MODEL = 'deepseek/deepseek-v4-flash';
  var RACE_EVERY_FAILED = '(race: every model failed — no reply)';
  var STORE_KEY = 'openzoo.ios.race.v1';

  var RACE_HTTP_NOTE = /^\((?:upstream error|request failed|payment failed|rate limited|stream timed out|stream stalled)/i;
  var RACE_MODEL_FAILED = /^\([^)]+ (?:failed:|returned nothing)/i;
  var RACE_FETCH_FAILED = /^(?:typeerror:\s*)?fetch failed$/i;

  /* Same curated bands as desktop grokui / podagent tiers. */
  var TIERS = {
    cheap: [
      'deepseek/deepseek-v4-flash',
      'meta-llama/llama-4-scout',
      'z-ai/glm-4.7-flash',
      'bytedance-seed/seed-2.0-mini',
      'meta-llama/llama-4-maverick',
      'z-ai/glm-4.5-air',
      'minimax/minimax-m2.5',
      'z-ai/glm-4.6v',
      'minimax/minimax-m2',
      'inclusionai/ling-3.0-flash'
    ],
    medium: [
      'deepseek/deepseek-v4-pro-0813',
      'z-ai/glm-4.7',
      'google/gemini-3.7-flash',
      'x-ai/grok-4.3',
      'moonshotai/kimi-k2.7-code',
      'z-ai/glm-5',
      'moonshotai/kimi-k2.6',
      'mistralai/mistral-large-2512',
      'bytedance-seed/seed-2.0-code',
      'qwen/qwen3.8-27b'
    ],
    expensive: [
      'anthropic/claude-opus-5',
      'openai/gpt-5.5',
      'anthropic/claude-sonnet-5',
      'x-ai/grok-4.6',
      'moonshotai/kimi-k3',
      'anthropic/claude-opus-4.8',
      'openai/gpt-5.4',
      'qwen/qwen3.8-max',
      'x-ai/grok-4.5'
    ],
    'grok4.6': [
      'x-ai/grok-4.6',
      'x-ai/grok-4.5',
      'x-ai/grok-4.3',
      'x-ai/grok-4.20'
    ]
  };

  var TIER_NAMES = ['cheap', 'medium', 'expensive', 'grok4.6'];
  var TIER_ALIASES = {
    grok: 'grok4.6',
    'grok 4.6': 'grok4.6',
    'grok-4.6': 'grok4.6',
    'grok4.6': 'grok4.6'
  };

  function normalizeTier(s) {
    var raw = String(s || '').trim().toLowerCase();
    if (TIER_NAMES.indexOf(raw) !== -1) return raw;
    if (TIER_ALIASES[raw]) return TIER_ALIASES[raw];
    var compact = raw.replace(/[\s_]/g, '');
    if (TIER_NAMES.indexOf(compact) !== -1) return compact;
    if (TIER_ALIASES[compact]) return TIER_ALIASES[compact];
    return null;
  }

  function tierPool(tier) {
    var name = normalizeTier(tier) || 'medium';
    return (TIERS[name] || TIERS.medium).slice();
  }

  function asIdSet(catalogIds) {
    if (!catalogIds) return null;
    if (typeof catalogIds.has === 'function') return catalogIds.size ? catalogIds : null;
    if (Array.isArray(catalogIds)) {
      var set = {};
      var n = 0;
      catalogIds.forEach(function (id) {
        if (id) { set[id] = true; n += 1; }
      });
      return n ? set : null;
    }
    return null;
  }

  function idIn(set, id) {
    if (!set) return true;
    if (typeof set.has === 'function') return set.has(id);
    return !!set[id];
  }

  function shuffle(list, rng) {
    var a = list.slice();
    var rand = rng || Math.random;
    var i, j, tmp;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(rand() * (i + 1));
      tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /**
   * Models a tier resolves to. `random` samples without replacement (a race
   * must not bill the same slug twice). Unreachable catalog → curated list.
   */
  function tierModels(tier, n, random, catalogIds, rng) {
    var want = tierPool(tier);
    var ids = asIdSet(catalogIds);
    var live = ids ? want.filter(function (m) { return idIn(ids, m); }) : want;
    var pool = live.length ? live : want;
    var take = Math.max(1, Math.min(Number(n) || 1, pool.length));
    if (!random) return pool.slice(0, take);
    return shuffle(pool, rng).slice(0, take);
  }

  /** "0" / "2" / "2 4" → { n, k }. Two numbers are k-of-n in either order. */
  function parseRaceValue(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s || s === '0') return { n: 0, k: 1 };
    var nums = s.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (!nums.length) return { n: 0, k: 1 };
    var n = nums.length === 1 ? nums[0] : Math.max(nums[0], nums[1]);
    var k = nums.length === 1 ? 1 : Math.min(nums[0], nums[1]);
    n = Math.max(0, Math.min(RACE_MAX, Math.round(n)));
    k = Math.max(1, Math.min(k, n || 1));
    if (n < 2) return { n: 0, k: 1 };
    return { n: n, k: k };
  }

  function raceDialValue(n, k) {
    var parsed = parseRaceValue((Number(k) > 1 ? String(k) + ' ' : '') + String(n || 0));
    if (parsed.n < 2) return '0';
    if (parsed.k > 1) return parsed.k + ' ' + parsed.n;
    return String(parsed.n);
  }

  function formatRaceStatus(back, need) {
    var n = Math.max(1, Number(need) || 1);
    var b = Math.min(n, Math.max(0, Number(back) || 0));
    return 'racing ' + b + '/' + n + ' back…';
  }

  function isRaceCountable(textOrArrival) {
    var arrival = textOrArrival && typeof textOrArrival === 'object' && !Array.isArray(textOrArrival)
      ? textOrArrival
      : { text: textOrArrival };
    if (arrival.error) return false;
    var s = String(arrival.text || '').trim();
    if (!s) return false;
    if (RACE_FETCH_FAILED.test(s)) return false;
    if (RACE_HTTP_NOTE.test(s)) return false;
    if (RACE_MODEL_FAILED.test(s)) return false;
    return true;
  }

  function raceLastShip(arrivals) {
    var list = Array.isArray(arrivals) ? arrivals : [];
    var i;
    for (i = list.length - 1; i >= 0; i--) {
      if (isRaceCountable(list[i])) {
        return { model: list[i].model, text: String(list[i].text) };
      }
    }
    return { model: '', text: RACE_EVERY_FAILED, error: true };
  }

  function raceFailKind(arrival) {
    var err = String(arrival && arrival.error || '');
    var text = String(arrival && arrival.text || '').trim();
    var s = (err + ' ' + text).trim();
    if (!s) return 'empty body';
    if (/timeout|STREAM_IDLE|aborted|AbortError/i.test(s)) return 'timeout';
    if (/402|payment failed/i.test(s)) return 'pay';
    if (/fetch failed/i.test(s)) return 'fetch failed';
    var http = /HTTP\s+(\d{3})/i.exec(s);
    if (http) return 'HTTP ' + http[1];
    if (err) return 'error';
    if (!isRaceCountable(arrival)) return 'empty body';
    return 'ok';
  }

  function shouldRetryRaceArrival(arrival) {
    if (isRaceCountable(arrival)) return false;
    var k = raceFailKind(arrival);
    return k === 'fetch failed' || k === 'timeout' || k === 'empty body'
      || k === 'error' || /^HTTP 5/.test(k) || k === 'HTTP 000';
  }

  function parseClassifyScore(text) {
    var s = String(text || '');
    var tagged = /SCORE\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(s);
    var lone = tagged || /\b(10|[0-9])(?:\s*\/\s*10)?\b/.exec(s);
    if (!lone) return 0;
    var n = Number(lone[1]);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(10, n));
  }

  function pickRaceWinner(cands, minScore) {
    var bar = minScore != null ? Number(minScore) : RACE_MIN_SCORE;
    var list = Array.isArray(cands) ? cands.filter(Boolean) : [];
    if (!list.length) return { winner: null, reason: 'empty', tied: [] };
    var passing = list.filter(function (c) { return (Number(c.score) || 0) >= bar; });
    if (!passing.length) {
      return { winner: list[list.length - 1], reason: 'fallback-last', tied: [] };
    }
    var max = -Infinity;
    passing.forEach(function (c) {
      var sc = Number(c.score) || 0;
      if (sc > max) max = sc;
    });
    var tied = passing.filter(function (c) { return (Number(c.score) || 0) === max; });
    if (tied.length === 1) return { winner: tied[0], reason: 'score', tied: tied };
    return { winner: null, reason: 'tie', tied: tied };
  }

  function createRaceFeed(onDelta, onStatus, need) {
    var live = null;
    var settled = false;
    var back = 0;
    var buf = {};
    var dead = {};
    function paintStatus() { if (onStatus) onStatus(formatRaceStatus(back, need)); }
    return {
      start: function () { paintStatus(); },
      liveModel: function () { return live; },
      onToken: function (model, chunk) {
        if (settled || chunk == null || chunk === '') return;
        buf[model] = (buf[model] || '') + chunk;
        if (!live) {
          live = model;
          if (onDelta) onDelta(chunk, { model: model });
          return;
        }
        if (live === model && onDelta) onDelta(chunk, { model: model });
      },
      onFail: function (model) {
        dead[model] = true;
        if (settled || live !== model) return;
        var next = null;
        Object.keys(buf).some(function (m) {
          if (m !== model && buf[m] && !dead[m]) { next = m; return true; }
          return false;
        });
        if (next) {
          live = next;
          if (onDelta) onDelta(buf[next], { replace: true, model: live });
        } else {
          live = null;
        }
      },
      onBack: function () {
        if (settled || back >= need) return;
        back += 1;
        paintStatus();
      },
      settle: function (winner) {
        settled = true;
        var text = winner && String(winner.text || '').trim()
          ? winner.text
          : RACE_EVERY_FAILED;
        if (winner && winner.model && live === winner.model && !winner.error) return;
        live = (winner && winner.model) || live;
        if (onDelta) onDelta(text, { replace: true, model: winner && winner.model });
      }
    };
  }

  function raceQuestion(messages) {
    var list = Array.isArray(messages) ? messages : [];
    var i;
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].role === 'user') {
        return typeof list[i].content === 'string' ? list[i].content : '(see candidates)';
      }
    }
    return '(see candidates)';
  }

  function classifyPrompt(messages, cand) {
    return 'Score this answer to one question from 0 to 10.\n\n'
      + 'QUESTION:\n' + String(raceQuestion(messages)).slice(0, 4000) + '\n\n'
      + 'ANSWER:\n' + String(cand && cand.text || '').slice(0, 6000) + '\n\n'
      + 'Judge on: correctness first, then completeness, then whether it actually did what was asked. '
      + 'Ignore length and confidence of tone.\n'
      + 'Reply with exactly: SCORE <n>';
  }

  function pairwisePrompt(messages, tied) {
    var letters = tied.map(function (_, i) { return String.fromCharCode(65 + i); });
    return 'You are judging answers to one question. Pick the single best one.\n\n'
      + 'QUESTION:\n' + String(raceQuestion(messages)).slice(0, 4000) + '\n\n'
      + tied.map(function (c, i) {
        return 'ANSWER ' + letters[i] + ':\n' + String(c.text || '').slice(0, 6000);
      }).join('\n\n')
      + '\n\nJudge on: correctness first, then completeness, then whether it actually did what was asked. '
      + 'Ignore length and confidence of tone.\n'
      + 'Reply with ONE letter and nothing else: ' + letters.join(' or ') + '.';
  }

  function defaultClassify(messages, cand, judge) {
    return Promise.resolve(judge(classifyPrompt(messages, cand), 24)).then(parseClassifyScore);
  }

  function defaultPairwise(messages, tied, judge) {
    return Promise.resolve(judge(pairwisePrompt(messages, tied), 8)).then(function (verdict) {
      var hit = String(verdict || '').toUpperCase().split('').filter(function (ch) {
        var n = ch.charCodeAt(0) - 65;
        return n >= 0 && n < tied.length;
      })[0];
      if (hit) return tied[hit.charCodeAt(0) - 65];
      return tied[tied.length - 1];
    }).catch(function () {
      return tied[tied.length - 1];
    });
  }

  /**
   * First X countable back of Y. `hooks`: { stream, classify, pairwise,
   * judge, minScore, signal, onArrivals }.
   */
  function brainRace(messages, onDelta, contextId, models, need, maxTokens, onStatus, hooks) {
    hooks = hooks || {};
    var stream = hooks.stream;
    if (typeof stream !== 'function') {
      return Promise.resolve(RACE_EVERY_FAILED);
    }
    var judge = typeof hooks.judge === 'function' ? hooks.judge : function () { return Promise.resolve(''); };
    var classify = hooks.classify || function (m, c) { return defaultClassify(m, c, judge); };
    var pairwise = hooks.pairwise || function (m, t) { return defaultPairwise(m, t, judge); };
    var minScore = hooks.minScore != null ? Number(hooks.minScore) : RACE_MIN_SCORE;
    var list = (models || []).filter(Boolean).slice(0, RACE_MAX);
    if (list.length < 2) {
      return stream(messages, onDelta, contextId, list[0], maxTokens);
    }
    var want = Math.max(1, Math.min(Number(need) || DEFAULT_NEED, list.length));

    var feed = createRaceFeed(onDelta, onStatus, want);
    feed.start();

    var done = [];
    var arrivals = [];
    var finished = 0;
    var release;
    var enough = new Promise(function (r) { release = r; });
    var raceAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (hooks.signal && raceAbort) {
      if (hooks.signal.aborted) raceAbort.abort();
      else hooks.signal.addEventListener('abort', function () { raceAbort.abort(); }, { once: true });
    }

    function aborted() {
      return !!(raceAbort && raceAbort.signal && raceAbort.signal.aborted);
    }

    function ship(cand) {
      var out = cand && String(cand.text || '').trim() ? cand : raceLastShip(arrivals);
      feed.settle(out);
      if (typeof hooks.onArrivals === 'function') {
        try { hooks.onArrivals(arrivals); } catch (_) {}
      }
      try { if (raceAbort) raceAbort.abort(); } catch (_) {}
      return out.text;
    }

    function runOne(m) {
      var last = { model: m, text: '', error: 'empty body' };
      var attempt = 0;

      function once() {
        if (aborted() && attempt > 0) return Promise.resolve();
        return Promise.resolve()
          .then(function () {
            return stream(
              messages,
              function (chunk) { feed.onToken(m, chunk); },
              contextId,
              m,
              maxTokens,
              raceAbort && raceAbort.signal
            );
          })
          .then(function (text) {
            last = { model: m, text: text == null ? '' : String(text) };
            if (isRaceCountable(last)) {
              arrivals.push(last);
              done.push(last);
              feed.onBack();
              return true;
            }
            return false;
          })
          .catch(function (e) {
            last = { model: m, text: '', error: (e && e.message) || 'error' };
            return false;
          })
          .then(function (ok) {
            if (ok) return;
            attempt += 1;
            if (!shouldRetryRaceArrival(last) || attempt >= 2 || aborted()) {
              arrivals.push(last);
              feed.onFail(m);
              return;
            }
            return once();
          });
      }

      return once();
    }

    var attempts = list.map(function (m) {
      return runOne(m).then(function () {
        finished += 1;
        if (done.length >= want || finished === list.length) release();
      }, function () {
        finished += 1;
        if (done.length >= want || finished === list.length) release();
      });
    });
    attempts.forEach(function (p) { p.catch(function () {}); });

    return enough.then(function () {
      var cands = done.slice(0, want);
      if (!cands.length) return ship(raceLastShip(arrivals));
      if (cands.length === 1) return ship(cands[0]);

      if (onStatus) onStatus('judging…');
      return Promise.all(cands.map(function (c) {
        return Promise.resolve()
          .then(function () { return classify(messages, c); })
          .then(function (score) { return Object.assign({}, c, { score: Number(score) || 0 }); })
          .catch(function () { return Object.assign({}, c, { score: 0 }); });
      })).then(function (scored) {
        var picked = pickRaceWinner(scored, minScore);
        if (picked.reason === 'tie' && picked.tied.length > 1) {
          return Promise.resolve()
            .then(function () { return pairwise(messages, picked.tied); })
            .then(function (broken) {
              var usable = broken && String(broken.text || '').trim();
              return ship(usable ? broken : picked.tied[picked.tied.length - 1]);
            })
            .catch(function () {
              return ship(picked.tied[picked.tied.length - 1]);
            });
        }
        return ship(picked.winner || scored[scored.length - 1] || raceLastShip(arrivals));
      });
    });
  }

  var api = {
    RACE_MAX: RACE_MAX,
    DEFAULT_N: DEFAULT_N,
    DEFAULT_NEED: DEFAULT_NEED,
    RACE_MIN_SCORE: RACE_MIN_SCORE,
    JUDGE_MODEL: JUDGE_MODEL,
    RACE_EVERY_FAILED: RACE_EVERY_FAILED,
    TIERS: TIERS,
    TIER_NAMES: TIER_NAMES,
    normalizeTier: normalizeTier,
    tierPool: tierPool,
    tierModels: tierModels,
    parseRaceValue: parseRaceValue,
    raceDialValue: raceDialValue,
    formatRaceStatus: formatRaceStatus,
    isRaceCountable: isRaceCountable,
    raceLastShip: raceLastShip,
    raceFailKind: raceFailKind,
    shouldRetryRaceArrival: shouldRetryRaceArrival,
    parseClassifyScore: parseClassifyScore,
    pickRaceWinner: pickRaceWinner,
    createRaceFeed: createRaceFeed,
    classifyPrompt: classifyPrompt,
    pairwisePrompt: pairwisePrompt,
    brainRace: brainRace,
    STORE_KEY: STORE_KEY
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooChatRace = api;
})(typeof window !== 'undefined' ? window : globalThis);
