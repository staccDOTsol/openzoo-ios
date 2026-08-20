'use strict';

var GATEWAY = 'https://x402-tokens.fly.dev';
var DEFAULT_MODEL = 'openai/gpt-4o-mini';
var STORE_KEY = 'openzoo.ios.threads.v1';
var TEXT_EXTS = {
  '.txt': 1, '.md': 1, '.json': 1, '.jsonl': 1, '.csv': 1, '.tsv': 1, '.log': 1,
  '.html': 1, '.htm': 1, '.xml': 1, '.py': 1, '.js': 1, '.mjs': 1, '.cjs': 1,
  '.ts': 1, '.tsx': 1, '.jsx': 1, '.rs': 1, '.go': 1, '.java': 1, '.c': 1,
  '.h': 1, '.cpp': 1, '.rb': 1, '.php': 1, '.sh': 1, '.sql': 1, '.yaml': 1,
  '.yml': 1, '.toml': 1, '.ini': 1
};
var AVATAR_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff'];

var wallet = { address: null, method: null };
var subscription = { tier: null, key: null, productId: null, pending: false, localUnlock: false };
var pendingSign = {};
var signSeq = 1;
var threads = [];
var activeId = null;
var pendingFiles = [];
var busy = false;
var directory = null;

var $log = document.getElementById('log');
var $threads = document.getElementById('threads');
var $inp = document.getElementById('inp');
var $model = document.getElementById('model');
var $chips = document.getElementById('attachChips');
var $plusMenu = document.getElementById('plusMenu');
var $sidebar = document.getElementById('sidebar');
var $scrim = document.getElementById('scrim');
var $modal = document.getElementById('modal');
var $modalTitle = document.getElementById('modal-title');
var $modalLead = document.getElementById('modal-lead');
var $modalBody = document.getElementById('modal-body');
var $modalActions = document.getElementById('modal-actions');

function uid() {
  return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadThreads() {
  try {
    var raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    threads = Array.isArray(raw) ? raw : [];
  } catch (_) {
    threads = [];
  }
  if (!threads.length) threads.push(blankThread());
  activeId = threads[0].id;
}

function saveThreads() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(threads)); } catch (_) {}
}

function blankThread() {
  return {
    id: uid(),
    name: 'New chat',
    model: DEFAULT_MODEL,
    messages: [],
    contextId: null,
    usingLabel: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function activeThread() {
  return threads.filter(function (t) { return t.id === activeId; })[0] || threads[0];
}

function initials(name) {
  return String(name || 'OZ').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'OZ';
}

function avatarColor(id) {
  var n = 0;
  String(id || '').split('').forEach(function (c) { n += c.charCodeAt(0); });
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

function previewOf(thread) {
  for (var i = thread.messages.length - 1; i >= 0; i--) {
    var m = thread.messages[i];
    if (m.role === 'user' || m.role === 'assistant') {
      return String(m.content || '').replace(/\s+/g, ' ').slice(0, 80);
    }
  }
  return thread.usingLabel || 'Say anything';
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function isContextMissing(payload, status) {
  var blob = typeof payload === 'string' ? payload : jsonText(payload || {});
  return status === 404 && /context_not_found/i.test(blob);
}

function api(path, options) {
  options = options || {};
  var headers = Object.assign({
    'Content-Type': 'application/json',
    'Authorization': subscription.key ? ('Bearer ' + subscription.key) : 'openzoo-ios'
  }, options.headers || {});
  return fetch(GATEWAY + path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(function (res) {
    return res.text().then(function (text) {
      var data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (_) { data = text; }
      }
      return { res: res, data: data, text: text };
    });
  }).catch(function (err) {
    throw new Error(OpenZooUserErrors.sanitize(err));
  });
}

function ensureDirectory() {
  if (directory) return Promise.resolve(directory);
  return OpenZooRails.loadSupported().then(function (parsed) {
    directory = parsed;
    return parsed;
  });
}

function closeModal() {
  $modal.classList.add('hidden');
  $modalBody.innerHTML = '';
  $modalActions.innerHTML = '';
}

function openModal(title, lead) {
  $modalTitle.textContent = title;
  $modalLead.textContent = lead || '';
  $modal.classList.remove('hidden');
}

function askChoice(title, lead, choices) {
  return new Promise(function (resolve) {
    openModal(title, lead);
    $modalBody.innerHTML = '';
    choices.forEach(function (choice) {
      var el = document.createElement('div');
      el.className = 'rail';
      el.innerHTML = '<strong></strong><div class="muted"></div>';
      el.querySelector('strong').textContent = choice.label;
      if (choice.detail) el.querySelector('.muted').textContent = choice.detail;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = choice.action || 'Use this';
      btn.onclick = function () { closeModal(); resolve(choice.value); };
      el.appendChild(btn);
      $modalBody.appendChild(el);
    });
    $modalActions.innerHTML = '<button type="button" class="ghost" id="modal-cancel">Not now</button>';
    document.getElementById('modal-cancel').onclick = function () {
      closeModal();
      resolve(null);
    };
  });
}

function requestSignTransaction(unsignedTxB64) {
  return new Promise(function (resolve, reject) {
    var id = 'tx-' + (signSeq++);
    pendingSign[id] = { resolve: resolve, reject: reject, kind: 'sign' };
    window.parent.postMessage({
      type: 'wallet-sign-transaction',
      id: id,
      transaction: unsignedTxB64
    }, '*');
  });
}

function requestSignAndSend(unsignedTxB64) {
  return new Promise(function (resolve, reject) {
    var id = 'send-' + (signSeq++);
    pendingSign[id] = { resolve: resolve, reject: reject, kind: 'send' };
    window.parent.postMessage({
      type: 'wallet-sign-and-send-transaction',
      id: id,
      transaction: unsignedTxB64
    }, '*');
  });
}

function encodePayment(envelope, signedTxB64) {
  var payment = {
    x402Version: envelope.x402Version || 1,
    scheme: envelope.scheme,
    network: envelope.network,
    payload: { transaction: signedTxB64 }
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payment))));
}

var settleInFlight = false;
var toastTimer = null;

function userFacingPayError(err) {
  return OpenZooUserErrors.sanitize(err);
}

function showCopiedToast(label) {
  var el = document.getElementById('copiedToast');
  if (!el) return;
  el.textContent = label || 'copied';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1400);
}

function copyValue(text) {
  return OpenZooClipboard.copyText(text).then(function () {
    showCopiedToast('copied');
  });
}

function isEditableTarget(el) {
  if (!el) return false;
  var tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return !!el.isContentEditable;
}

function bindSelectionCopy() {
  var last = '';
  function fromSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    var node = sel.anchorNode;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (isEditableTarget(el) || isEditableTarget(document.activeElement)) return;
    var text = String(sel.toString() || '').trim();
    if (!text || text === last) return;
    last = text;
    copyValue(text);
  }
  document.addEventListener('mouseup', fromSelection);
  document.addEventListener('touchend', fromSelection);
}

function promptCopyAddress(title, lead) {
  return new Promise(function (resolve) {
    openModal(title, lead);
    $modalBody.innerHTML = '';
    var addr = document.createElement('div');
    addr.className = 'waddr copyable';
    addr.textContent = wallet.address || '';
    addr.onclick = function () { copyValue(wallet.address); };
    $modalBody.appendChild(addr);
    var hint = document.createElement('p');
    hint.className = 'wsub';
    hint.textContent = 'Tap the address to copy it.';
    $modalBody.appendChild(hint);
    $modalActions.innerHTML = '<button type="button" class="ghost" id="modal-ok">OK</button>';
    document.getElementById('modal-ok').onclick = function () {
      closeModal();
      resolve();
    };
  });
}

function splitCorpus(text) {
  var max = 1800000;
  if (text.length <= max) return [text];
  var parts = [];
  var rest = text;
  while (rest.length > max) {
    var cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}

function bindCorpus(text, existingId) {
  var parts = splitCorpus(text);
  var contextId = existingId || null;
  var chain = Promise.resolve();
  parts.forEach(function (part) {
    chain = chain.then(function () {
      var body = { corpus: part };
      if (contextId) body.context_id = contextId;
      return api('/v1/hrr/bind', { method: 'POST', body: body }).then(function (out) {
        if (!out.res.ok || !out.data || !out.data.context_id) {
          throw new Error('Could not use those files');
        }
        contextId = out.data.context_id;
      });
    });
  });
  return chain.then(function () { return contextId; });
}

function extOf(name) {
  var i = String(name || '').lastIndexOf('.');
  return i >= 0 ? String(name).slice(i).toLowerCase() : '';
}

function isTextFile(file) {
  if (!file) return false;
  if (file.type && file.type.indexOf('text/') === 0) return true;
  if (file.type === 'application/json') return true;
  return !!TEXT_EXTS[extOf(file.name)];
}

function readFileText(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('Could not read ' + (file.name || 'file'))); };
    reader.readAsText(file);
  });
}

function readFileDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('Could not read photo')); };
    reader.readAsDataURL(file);
  });
}

function renderChips() {
  $chips.innerHTML = '';
  pendingFiles.forEach(function (item, idx) {
    var el = document.createElement('div');
    el.className = 'achip' + (item.kind === 'image' ? ' aimg' : '');
    if (item.kind === 'image' && item.dataUrl) {
      el.innerHTML = '<img alt=""><span class="ax">×</span>';
      el.querySelector('img').src = item.dataUrl;
    } else {
      el.innerHTML = '<span></span><span class="ax">×</span>';
      el.querySelector('span').textContent = item.name;
    }
    el.querySelector('.ax').onclick = function () {
      pendingFiles.splice(idx, 1);
      renderChips();
    };
    $chips.appendChild(el);
  });
}

function addPendingFiles(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  var jobs = files.map(function (file) {
    if (file.type && file.type.indexOf('image/') === 0) {
      return readFileDataUrl(file).then(function (dataUrl) {
        pendingFiles.push({ kind: 'image', name: file.name || 'photo', dataUrl: dataUrl });
      });
    }
    if (isTextFile(file) || !file.type) {
      return readFileText(file).then(function (text) {
        pendingFiles.push({
          kind: 'text',
          name: file.name || 'note',
          text: '===== ' + (file.name || 'note') + ' =====\n' + text
        });
      });
    }
    pendingFiles.push({ kind: 'file', name: file.name || 'file' });
    return Promise.resolve();
  });
  return Promise.all(jobs).then(renderChips);
}

function consumeAttachments(thread) {
  if (!pendingFiles.length) return Promise.resolve();
  var texts = pendingFiles.filter(function (f) { return f.kind === 'text' && f.text; });
  var names = pendingFiles.map(function (f) { return f.name; });
  var corpus = texts.map(function (f) { return f.text; }).join('\n\n');
  var images = pendingFiles.filter(function (f) { return f.kind === 'image'; });
  thread.pendingImages = images.map(function (f) { return f.dataUrl; });
  pendingFiles = [];
  renderChips();
  if (!corpus.trim()) {
    thread.usingLabel = names.length ? ('Using ' + names.length + (names.length === 1 ? ' file' : ' files')) : '';
    saveThreads();
    renderHeader();
    return Promise.resolve();
  }
  return bindCorpus(corpus, thread.contextId).then(function (id) {
    thread.contextId = id;
    thread.usingLabel = 'Using ' + names.length + (names.length === 1 ? ' file' : ' files');
    saveThreads();
    renderHeader();
  });
}

function renderHeader() {
  var t = activeThread();
  document.getElementById('header-name').textContent = t.name;
  document.getElementById('header-sub').textContent = t.usingLabel || (subscription.tier
    ? (subscription.tier + (subscription.pending ? ' · finishing setup' : ''))
    : (wallet.address
      ? (wallet.address.slice(0, 4) + '…' + wallet.address.slice(-4))
      : 'openzoo'));
  var av = document.getElementById('header-avatar');
  av.textContent = initials(t.name);
  av.style.background = avatarColor(t.id);
  if (t.model) $model.value = t.model;
}

function renderSidebar() {
  var q = document.getElementById('search').value.trim().toLowerCase();
  $threads.innerHTML = '';
  threads.forEach(function (t) {
    if (q && (t.name + ' ' + previewOf(t)).toLowerCase().indexOf(q) === -1) return;
    var row = document.createElement('div');
    row.className = 'trow' + (t.id === activeId ? ' active' : '');
    row.innerHTML = '<div class="tavatar"></div><div class="tmeta"><div class="tname"></div><div class="tprev"></div></div><button class="tclose" type="button">×</button>';
    var av = row.querySelector('.tavatar');
    av.textContent = initials(t.name);
    av.style.background = avatarColor(t.id);
    row.querySelector('.tname').textContent = t.name;
    row.querySelector('.tprev').textContent = previewOf(t);
    row.onclick = function (ev) {
      if (ev.target.classList.contains('tclose')) return;
      activeId = t.id;
      closeSidebar();
      renderSidebar();
      renderLog();
      renderHeader();
    };
    row.querySelector('.tclose').onclick = function (ev) {
      ev.stopPropagation();
      threads = threads.filter(function (x) { return x.id !== t.id; });
      if (!threads.length) threads.push(blankThread());
      if (activeId === t.id) activeId = threads[0].id;
      saveThreads();
      renderSidebar();
      renderLog();
      renderHeader();
    };
    $threads.appendChild(row);
  });
}

function addBubble(role, text, extra) {
  extra = extra || {};
  var row = document.createElement('div');
  row.className = 'row ' + (role === 'user' ? 'user' : 'bot') + (extra.pending ? ' pending' : '') + (extra.err ? ' err' : '');
  var bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (extra.images && extra.images.length) {
    var imgs = document.createElement('div');
    imgs.className = 'bubble-images';
    extra.images.forEach(function (src) {
      var img = document.createElement('img');
      img.src = src;
      imgs.appendChild(img);
    });
    bubble.appendChild(imgs);
  }
  var txt = document.createElement('div');
  txt.textContent = text;
  bubble.appendChild(txt);
  row.appendChild(bubble);
  $log.appendChild(row);
  $log.scrollTop = $log.scrollHeight;
  return { row: row, text: txt };
}

function renderLog() {
  $log.innerHTML = '';
  var t = activeThread();
  if (!t.messages.length) {
    addBubble('assistant', 'Welcome to the zoo. Attach files or photos if you want this chat to use them — then just talk.');
  }
  t.messages.forEach(function (m) {
    if (m.role !== 'user' && m.role !== 'assistant') return;
    addBubble(m.role, m.content, { images: m.images, err: m.err });
  });
}

function openSidebar() {
  $sidebar.classList.add('open');
  $scrim.classList.add('show');
}
function closeSidebar() {
  $sidebar.classList.remove('open');
  $scrim.classList.remove('show');
}

function loadModels() {
  return api('/v1/models').then(function (out) {
    var rows = (out.data && out.data.data) || [];
    var ids = rows.map(function (m) { return m.id; }).filter(function (id) {
      return id && id.indexOf('~') !== 0 && id.indexOf(':batch') === -1;
    });
    if (ids.indexOf(DEFAULT_MODEL) === -1) ids.unshift(DEFAULT_MODEL);
    $model.innerHTML = '';
    var seen = {};
    ids.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true;
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      if (id === (activeThread().model || DEFAULT_MODEL)) opt.selected = true;
      $model.appendChild(opt);
    });
  }).catch(function () {
    $model.innerHTML = '';
    var opt = document.createElement('option');
    opt.value = DEFAULT_MODEL;
    opt.textContent = DEFAULT_MODEL;
    $model.appendChild(opt);
  });
}

function chatHeaders(thread, payment) {
  var headers = {};
  if (thread.contextId) headers['X-HRR-Context'] = thread.contextId;
  if (payment) headers['X-PAYMENT'] = payment;
  return headers;
}

function payForAccept(row) {
  if (!wallet.address) throw new Error('Connect a wallet in the shell first.');
  var prev = OpenZooPay402.load() || {};
  OpenZooPay402.persist({
    threadId: prev.threadId,
    userText: prev.userText,
    accepts: prev.accepts && prev.accepts.length ? prev.accepts : [row],
    lastAccept: row,
    at: prev.at || Date.now()
  });
  return api('/v1/pay/build', {
    method: 'POST',
    body: { accept: row, payer: wallet.address }
  }).then(function (out) {
    if (!out.res.ok) {
      throw new Error(typeof out.data === 'string' ? out.data : 'Could not build payment');
    }
    return requestSignTransaction(out.data.transaction).then(function (signed) {
      return encodePayment(out.data.envelope, signed);
    });
  });
}

function topUpAndRetry(row, plan) {
  var need = plan.need - plan.twinHeld;
  if (need < 1n) need = 1n;
  return Promise.all([
    OpenZooSolana.getTokenAccountBalance(plan.source.acquire.escrow),
    OpenZooSolana.getTokenSupply(plan.mint),
    OpenZooSolana.getAccountInfo(plan.mint),
    OpenZooSolana.getBalanceLamports(wallet.address)
  ]).then(function (parts) {
    var deposit = OpenZooWrap.depositForShares(need, parts[0], parts[1]);
    if (plan.underHeld < deposit) {
      return promptCopyAddress(
        'You have ' + plan.source.underlyingSymbol + ', but need a bit more',
        'Send more ' + plan.source.underlyingSymbol + ' to this address, then try again.'
      ).then(function () {
        throw new Error('This wallet needs a top-up from ' + plan.source.underlyingSymbol + ' before that message can send.');
      });
    }
    if (parts[3] < 5000) {
      return promptCopyAddress(
        'This wallet needs a little SOL for the network fee',
        'Copy this address, send a little SOL, then try again.'
      ).then(function () {
        throw new Error('This wallet needs a little SOL for the network fee');
      });
    }
    var wrappedProgram = OpenZooWrap.mintOwnerProgram(parts[2]);
    return OpenZooWrap.buildUnsignedWrapTx({
      source: plan.source,
      owner: wallet.address,
      depositRaw: deposit,
      wrappedProgram: wrappedProgram
    });
  }).then(function (built) {
    return requestSignAndSend(built.transaction);
  }).then(function (signature) {
    return OpenZooSolana.confirmSignature(signature);
  }).then(function () {
    return payForAccept(row);
  });
}

function settle402(accepts) {
  settleInFlight = true;
  return ensureDirectory().then(function (parsed) {
    var live = OpenZooRails.liveAccepts(accepts, parsed);
    var deprecated = OpenZooRails.deprecatedAccepts(accepts);
    if (!live.length) {
      if (deprecated.length) {
        throw new Error('That payment option is no longer available. Try again in a moment.');
      }
      throw new Error('No payment option is available right now.');
    }
    if (!wallet.address) throw new Error('Connect a wallet in the shell first.');
    return OpenZooSolana.getParsedTokenAccounts(wallet.address).then(function (accounts) {
      var holdings = OpenZooWrap.holdingsMap(accounts);
      var covered = [];
      var wrappable = [];
      live.forEach(function (row) {
        var plan = OpenZooWrap.resolveWrapPlan(parsed, row, accounts);
        var twin = holdings[OpenZooRails.acceptAsset(row)];
        var need = BigInt(row.maxAmountRequired || '0');
        if (twin && twin.raw >= need) covered.push({ row: row, plan: plan });
        else if (plan && plan.canWrap) wrappable.push({ row: row, plan: plan });
      });
      if (covered.length) {
        return payForAccept(covered[0].row).catch(function (err) {
          if (!wrappable.length) throw err;
          return runTopup(parsed, live, accounts, wrappable);
        });
      }
      return runTopup(parsed, live, accounts, wrappable);
    });
  }).then(function (payment) {
    settleInFlight = false;
    return payment;
  }, function (err) {
    settleInFlight = false;
    throw err;
  });
}

function promptNeedFunds(parsed, live) {
  return OpenZooSolana.getBalanceLamports(wallet.address).then(function (lamports) {
    if (lamports < 5000) {
      return promptCopyAddress(
        'This wallet needs a little SOL for the network fee',
        'Copy this address, send a little SOL, then try again.'
      ).then(function () {
        throw new Error('This wallet needs a little SOL for the network fee');
      });
    }
    var seen = {};
    var names = [];
    (live || []).forEach(function (row) {
      var src = OpenZooRails.wrapSource(parsed, OpenZooRails.acceptAsset(row));
      var sym = src && src.underlyingSymbol;
      if (!sym || seen[sym]) return;
      seen[sym] = true;
      names.push(sym);
    });
    if (!names.length) names = ['TOKEN', 'USDC', 'LEOS'];
    return promptCopyAddress(
      'Send ' + names.join(', ') + ' to keep chatting',
      'This wallet does not have those yet. Tap the address to copy it, send one, then try again.'
    ).then(function () {
      throw new Error('This wallet needs a top-up before that message can send.');
    });
  });
}

function runTopup(parsed, live, accounts, wrappable) {
  var ez = OpenZooWrap.chooseEzTopup(parsed, live, accounts);
  if (!ez.length) {
    return promptNeedFunds(parsed, live);
  }
  var pick = askChoice(
    'Wrap to send this',
    ez.length === 1
      ? ('You have ' + ez[0].symbol + '. Wrap enough to send this?')
      : 'You have more than one token. Wrap enough of one to send this?',
    ez.map(function (item) {
      return {
        label: item.symbol,
        action: 'Wrap ' + item.symbol,
        value: item
      };
    })
  );
  return pick.then(function (choice) {
    if (!choice) throw new Error('Top-up cancelled');
    var match = wrappable.filter(function (w) { return w.plan && w.plan.source && w.plan.source.underlying === choice.source.underlying; })[0]
      || wrappable.filter(function (w) { return w.row.asset === choice.mint; })[0];
    if (!match) match = { row: live[0], plan: OpenZooWrap.resolveWrapPlan(parsed, live[0], accounts) };
    openModal('Top up', 'Approve in your wallet. This only adds what this chat needs.');
    $modalBody.textContent = '';
    $modalActions.innerHTML = '';
    return topUpAndRetry(match.row, match.plan).then(function (payment) {
      closeModal();
      return payment;
    });
  });
}

function sendChat(userText, payment) {
  var thread = activeThread();
  var images = thread.pendingImages || [];
  thread.pendingImages = null;
  if (!payment) {
    thread.messages.push({ role: 'user', content: userText, images: images });
    if (thread.name === 'New chat') thread.name = userText.slice(0, 32);
    thread.updatedAt = Date.now();
    saveThreads();
    renderSidebar();
    renderHeader();
    addBubble('user', userText, { images: images });
  }
  var thinking = addBubble('assistant', '…', { pending: true });
  var body = {
    model: $model.value || thread.model || DEFAULT_MODEL,
    messages: [{
      role: 'system',
      content: 'You are OpenZoo. Be useful and concise. The user may have attached files for this chat; use that material when it helps. Do not mention payment rails, bind endpoints, or context ids.'
    }].concat(thread.messages.filter(function (m) {
      return m.role === 'user' || m.role === 'assistant';
    }).map(function (m) {
      return { role: m.role, content: m.content };
    }))
  };
  return api('/v1/chat/completions', {
    method: 'POST',
    headers: chatHeaders(thread, payment),
    body: body
  }).then(function (out) {
    if (out.res.status === 402) {
      OpenZooPay402.persist({
        threadId: thread.id,
        userText: userText,
        accepts: (out.data && out.data.accepts) || [],
        at: Date.now()
      });
      if (wallet.address) {
        thinking.text.textContent = 'Working on it…';
        return settle402((out.data && out.data.accepts) || []).then(function (xPayment) {
          thinking.row.remove();
          return sendChat(userText, xPayment);
        }).catch(function (err) {
          mark402TerminalUnlessRetryable(err);
          thinking.row.classList.add('err');
          thinking.text.textContent = userFacingPayError(err);
        });
      }
      if (subscription.localUnlock) {
        thinking.row.classList.add('err');
        thinking.text.textContent = 'This session is unlocked locally. The zoo still asked for a subscription key.';
        return;
      }
      if (subscription.key || subscription.pending) {
        thinking.row.classList.add('err');
        thinking.text.textContent = subscription.pending
          ? 'Your App Store purchase is saved. The zoo still needs to mint the subscription key.'
          : 'This chat is on a subscription key. The zoo asked for a per-call payment anyway — we did not open a wallet.';
        return;
      }
      thinking.row.classList.add('err');
      thinking.text.textContent = 'A subscription is required. Open Plan to subscribe on the App Store.';
      return;
    }
    if (isContextMissing(out.data, out.res.status)) {
      thread.contextId = null;
      saveThreads();
      thinking.row.classList.add('err');
      thinking.text.textContent = 'Those files need to be attached again.';
      return;
    }
    if (!out.res.ok) {
      thinking.row.classList.add('err');
      thinking.text.textContent = typeof out.data === 'string' ? out.data : 'The zoo hiccuped.';
      return;
    }
    var choice = out.data && out.data.choices && out.data.choices[0];
    var reply = choice && choice.message && choice.message.content;
    if (!reply) reply = 'The zoo returned something unusual.';
    thinking.row.classList.remove('pending');
    thinking.text.textContent = reply;
    thread.messages.push({ role: 'assistant', content: reply });
    thread.updatedAt = Date.now();
    saveThreads();
    renderSidebar();
    OpenZooPay402.clear();
  }).catch(function (err) {
    mark402TerminalUnlessRetryable(err);
    thinking.row.classList.add('err');
    thinking.text.textContent = userFacingPayError(err);
  });
}

function mark402TerminalUnlessRetryable(err) {
  if (OpenZooUserErrors.isRetryable(err)) return;
  var cur = OpenZooPay402.load();
  if (!cur) return;
  OpenZooPay402.persist(Object.assign({}, cur, { terminal: true }));
}

function retryPending402() {
  var st = OpenZooPay402.load();
  if (!OpenZooPay402.shouldRetryAfterResume(st, {
    hasPendingSign: Object.keys(pendingSign).length > 0,
    settleInFlight: settleInFlight,
    threadId: activeThread() && activeThread().id,
    requireWallet: true,
    walletAddress: wallet.address
  })) return;
  if (busy) return;
  busy = true;
  document.getElementById('send').disabled = true;
  var thinking = addBubble('assistant', 'Working on it…', { pending: true });
  settle402(st.accepts).then(function (xPayment) {
    thinking.row.remove();
    return sendChat(st.userText, xPayment);
  }).catch(function (err) {
    mark402TerminalUnlessRetryable(err);
    thinking.row.classList.add('err');
    thinking.text.textContent = userFacingPayError(err);
  }).then(function () {
    busy = false;
    document.getElementById('send').disabled = false;
  });
}

function submit() {
  var text = $inp.value.trim();
  if ((!text && !pendingFiles.length) || busy) return;
  busy = true;
  document.getElementById('send').disabled = true;
  var thread = activeThread();
  consumeAttachments(thread).then(function () {
    if (!text) text = thread.usingLabel ? 'Use what I just attached.' : '';
    if (!text) return;
    $inp.value = '';
    $inp.style.height = 'auto';
    return sendChat(text);
  }).catch(function (err) {
    addBubble('assistant', userFacingPayError(err), { err: true });
  }).then(function () {
    busy = false;
    document.getElementById('send').disabled = false;
  });
}

function showPlan() {
  document.getElementById('walletOverlay').classList.add('show');
  var body = document.getElementById('wallet-body');
  var label = subscription.tier ? subscription.tier : 'none yet';
  var extra = subscription.pending ? 'Purchase saved. Waiting on POST /api/billing/appstore to mint the same key Stripe checkout would.' : '';
  if (subscription.localUnlock && !subscription.productId) extra = extra || 'Local debug session.';
  body.innerHTML = '<div class="waddr"></div><p class="wsub" id="plan-extra"></p>';
  body.querySelector('.waddr').textContent = 'Plan: ' + label + (subscription.productId ? ' · ' + subscription.productId : '');
  body.querySelector('#plan-extra').textContent = extra;
  var crypto = document.getElementById('wallet-crypto');
  if (wallet.address) {
    crypto.innerHTML = '';
    var addr = document.createElement('div');
    addr.className = 'waddr copyable';
    addr.textContent = wallet.address;
    addr.onclick = function () { copyValue(wallet.address); };
    crypto.appendChild(addr);
    var hint = document.createElement('p');
    hint.className = 'wsub';
    hint.textContent = wallet.method === 'burner'
      ? 'This is your local burner. Tap the address to copy it.'
      : 'Tap the address to copy it.';
    crypto.appendChild(hint);
  } else {
    crypto.textContent = 'No wallet connected.';
  }
}

document.getElementById('menu-btn').onclick = openSidebar;
document.getElementById('close-sidebar').onclick = closeSidebar;
$scrim.onclick = closeSidebar;
function startNewChat() {
  var t = blankThread();
  threads.unshift(t);
  activeId = t.id;
  saveThreads();
  closeSidebar();
  renderSidebar();
  renderLog();
  renderHeader();
}
document.getElementById('header-new-chat').onclick = startNewChat;
document.getElementById('new-thread').onclick = startNewChat;
document.getElementById('search').addEventListener('input', renderSidebar);
document.getElementById('plus-btn').onclick = function () {
  $plusMenu.classList.toggle('show');
};
document.getElementById('attach-files').onclick = function () {
  $plusMenu.classList.remove('show');
  document.getElementById('file-inp').click();
};
document.getElementById('attach-photos').onclick = function () {
  $plusMenu.classList.remove('show');
  document.getElementById('photo-inp').click();
};
document.getElementById('attach-folder').onclick = function () {
  $plusMenu.classList.remove('show');
  document.getElementById('folder-inp').click();
};
document.getElementById('attach-paste').onclick = function () {
  $plusMenu.classList.remove('show');
  var pasted = window.prompt('Paste the text this chat should use');
  if (!pasted || !pasted.trim()) return;
  pendingFiles.push({ kind: 'text', name: 'pasted note', text: pasted });
  renderChips();
};
['file-inp', 'photo-inp', 'folder-inp'].forEach(function (id) {
  document.getElementById(id).addEventListener('change', function (ev) {
    addPendingFiles(ev.target.files);
    ev.target.value = '';
  });
});
document.getElementById('send').onclick = submit;
$inp.addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    submit();
  }
});
$inp.addEventListener('input', function () {
  $inp.style.height = 'auto';
  $inp.style.height = Math.min($inp.scrollHeight, 120) + 'px';
});
$model.addEventListener('change', function () {
  activeThread().model = $model.value;
  saveThreads();
});
document.getElementById('plan-btn').onclick = showPlan;
document.getElementById('wallet-close').onclick = function () {
  document.getElementById('walletOverlay').classList.remove('show');
};
document.getElementById('restore-btn').onclick = function () {
  window.parent.postMessage({ type: 'restore-purchases' }, '*');
};
document.getElementById('change-plan-btn').onclick = function () {
  window.parent.postMessage({ type: 'show-paywall' }, '*');
};
document.getElementById('wallet-connect-btn').onclick = function () {
  window.parent.postMessage({ type: 'show-advanced-wallet' }, '*');
};
document.getElementById('exit-btn').onclick = function () {
  window.parent.postMessage({ type: 'show-paywall' }, '*');
};

window.addEventListener('message', function (event) {
  if (event.source !== window.parent) return;
  var data = event.data;
  if (!data || !data.type) return;
  if (data.type === 'app-resume') {
    retryPending402();
    return;
  }
  if (data.type === 'subscription') {
    subscription.tier = data.tier || null;
    subscription.key = data.key || null;
    subscription.productId = data.productId || null;
    subscription.pending = !!data.pending;
    subscription.localUnlock = !!data.localUnlock;
    if (data.address) {
      wallet.address = data.address;
      wallet.method = data.method;
    }
    renderHeader();
  }
  if (data.type === 'wallet-connected') {
    wallet.address = data.address;
    wallet.method = data.method;
    renderHeader();
    retryPending402();
  }
  if (data.type === 'wallet-disconnected') {
    wallet.address = null;
    wallet.method = null;
    renderHeader();
  }
  if ((data.type === 'wallet-sign-transaction-response' || data.type === 'wallet-sign-and-send-transaction-response') && data.id && pendingSign[data.id]) {
    var waiter = pendingSign[data.id];
    delete pendingSign[data.id];
    if (data.error) waiter.reject(new Error(data.error));
    else waiter.resolve(data.signedTransaction || data.signature);
  }
});

window.parent.postMessage({ type: 'subscription-request' }, '*');
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') retryPending402();
});
bindSelectionCopy();
loadThreads();
renderSidebar();
renderLog();
renderHeader();
loadModels();
ensureDirectory().catch(function () {});
retryPending402();
