/* Resolve the iOS model picker onto a door model id.
 *
 * Auto is the server-side classifier (`openzoo/auto`). The client never
 * classifies the prompt, never remaps Auto onto a cheap/medium/expensive
 * band, and never launches ling/llama/gemini/nemo racers for Auto.
 */
(function (root) {
  'use strict';

  var AUTO_MODEL = 'openzoo/auto';
  var AUTO_LABEL = 'Auto';
  var DEFAULT_MODEL = AUTO_MODEL;

  function normalizeId(id) {
    return String(id == null ? '' : id).trim();
  }

  function isAutoModel(id) {
    var s = normalizeId(id);
    if (!s) return true;
    var lower = s.toLowerCase();
    return lower === 'auto' || lower === AUTO_MODEL;
  }

  function resolveChatModel(id) {
    if (isAutoModel(id)) return AUTO_MODEL;
    return normalizeId(id);
  }

  function catalogModelIds(rows) {
    return (rows || []).map(function (m) {
      return m && m.id;
    }).filter(function (id) {
      return id && id.indexOf('~') !== 0 && id.indexOf(':batch') === -1;
    });
  }

  function pickerOptions(catalogIds, selected) {
    var ids = [];
    var seen = {};
    function add(id) {
      var raw = normalizeId(id);
      if (!raw) return;
      var resolved = raw.toLowerCase() === 'auto' ? AUTO_MODEL : raw;
      if (seen[resolved]) return;
      seen[resolved] = true;
      ids.push(resolved);
    }
    add(AUTO_MODEL);
    (catalogIds || []).forEach(add);
    add(resolveChatModel(selected));
    var current = resolveChatModel(selected);
    return ids.map(function (id) {
      return {
        value: id,
        label: id === AUTO_MODEL ? AUTO_LABEL : id,
        selected: id === current
      };
    });
  }

  function shouldRace(model, raceSpec) {
    if (isAutoModel(model)) return false;
    var n = raceSpec && Number(raceSpec.n);
    return n >= 2;
  }

  /**
   * What sendChat would POST. Auto is always one id — never a tier list.
   * Named models stay named. Race only expands a named model.
   */
  function planSend(opts) {
    opts = opts || {};
    var model = resolveChatModel(opts.model);
    var raceSpec = opts.raceSpec || { n: 0, k: 1 };
    var listed = Array.isArray(opts.tierModels) ? opts.tierModels.filter(Boolean) : [];
    if (!shouldRace(model, raceSpec)) {
      return { model: model, models: [model], race: false };
    }
    if (listed.length >= 2) {
      return { model: model, models: listed.slice(), race: true };
    }
    return { model: listed[0] || model, models: [listed[0] || model], race: false };
  }

  var api = {
    AUTO_MODEL: AUTO_MODEL,
    AUTO_LABEL: AUTO_LABEL,
    DEFAULT_MODEL: DEFAULT_MODEL,
    isAutoModel: isAutoModel,
    resolveChatModel: resolveChatModel,
    catalogModelIds: catalogModelIds,
    pickerOptions: pickerOptions,
    shouldRace: shouldRace,
    planSend: planSend
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.OpenZooChatModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
