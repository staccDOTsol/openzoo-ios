'use strict';

var GATEWAY = 'https://x402-tokens.fly.dev';
var DEFAULT_MODEL = 'openai/gpt-4o-mini';
var SOLANA_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
var ALLOWED_RAILS = {
  '6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv': { symbol: 'yUSDCx', decimals: 6 },
  'FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B': { symbol: 'wTOKENx', decimals: 6 },
  '3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35': { symbol: 'wLEOSx', decimals: 9 }
};
var TWIN_NOTE = 'These settle in wrapped twins, not plain USDC. If the wallet doesn’t hold the twin, simulation fails.';

var wallet = { address: null, method: null };
var contextId = null;
var pendingSign = {};
var signSeq = 1;
var messages = [{
  role: 'system',
  content: 'You are OpenZoo on iOS. You only chat, bind a text corpus, and read gateway stats against https://x402-tokens.fly.dev. Do not invent local servers or desktop tool commands.'
}];

var $walletLabel = document.getElementById('wallet-label');
var $model = document.getElementById('model');
var $chatLog = document.getElementById('chat-log');
var $chatInput = document.getElementById('chat-input');
var $bindOut = document.getElementById('bind-out');
var $statsOut = document.getElementById('stats-out');
var $modal = document.getElementById('modal');
var $modalTitle = document.getElementById('modal-title');
var $modalLead = document.getElementById('modal-lead');
var $modalBody = document.getElementById('modal-body');
var $modalActions = document.getElementById('modal-actions');

function addBubble(who, text, cls) {
  var el = document.createElement('div');
  el.className = 'bubble' + (cls ? ' ' + cls : '');
  el.innerHTML = '<div class="who"></div><div class="txt"></div>';
  el.querySelector('.who').textContent = who;
  el.querySelector('.txt').textContent = text;
  $chatLog.appendChild(el);
  $chatLog.scrollTop = $chatLog.scrollHeight;
}

function setWalletLabel() {
  if (!wallet.address) {
    $walletLabel.textContent = 'no wallet — connect in the shell to pay';
    return;
  }
  $walletLabel.textContent = wallet.address.slice(0, 4) + '…' + wallet.address.slice(-4) + ' · ' + wallet.method;
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function isContextMissing(payload, status) {
  var blob = typeof payload === 'string' ? payload : jsonText(payload || {});
  return status === 404 && /context_not_found/i.test(blob);
}

function allowedRail(row) {
  if (!row || row.network !== SOLANA_NETWORK) return false;
  return Object.prototype.hasOwnProperty.call(ALLOWED_RAILS, row.asset);
}

function formatAmount(row) {
  var meta = ALLOWED_RAILS[row.asset] || {};
  var decimals = (row.extra && row.extra.decimals != null) ? row.extra.decimals : (meta.decimals || 0);
  var raw = row.maxAmountRequired || '0';
  var n = Number(raw);
  if (!isFinite(n)) return raw + ' atoms';
  return (n / Math.pow(10, decimals)).toFixed(Math.min(decimals, 6)) + ' ' + (row.extra && row.extra.symbol || meta.symbol || row.asset);
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

function api(path, options) {
  options = options || {};
  var headers = Object.assign({
    'Content-Type': 'application/json',
    'Authorization': 'openzoo-ios'
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
  });
}

function loadModels() {
  return api('/v1/models').then(function (out) {
    var rows = (out.data && out.data.data) || [];
    $model.innerHTML = '';
    var ids = rows.map(function (m) { return m.id; }).filter(Boolean);
    if (ids.indexOf(DEFAULT_MODEL) === -1 && ids.length) {
      ids.unshift(DEFAULT_MODEL);
    }
    if (ids.indexOf(DEFAULT_MODEL) === -1) ids.unshift(DEFAULT_MODEL);
    var seen = {};
    ids.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true;
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      if (id === DEFAULT_MODEL) opt.selected = true;
      $model.appendChild(opt);
    });
    if (!rows.length) {
      addBubble('gateway', 'GET /v1/models failed; left the last live default ' + DEFAULT_MODEL + ' selected.', 'err');
    }
  }).catch(function (err) {
    var opt = document.createElement('option');
    opt.value = DEFAULT_MODEL;
    opt.textContent = DEFAULT_MODEL;
    $model.appendChild(opt);
    addBubble('gateway', 'Could not load models: ' + (err.message || err), 'err');
  });
}

function refreshStats() {
  $statsOut.textContent = 'loading…';
  return api('/v1/stats').then(function (out) {
    $statsOut.textContent = jsonText(out.data);
  }).catch(function (err) {
    $statsOut.textContent = String(err.message || err);
  });
}

function bindCorpus() {
  var corpus = document.getElementById('corpus').value.trim();
  if (!corpus) {
    $bindOut.textContent = 'Paste or pick a text file first.';
    return Promise.resolve();
  }
  var body = { corpus: corpus };
  if (contextId) body.context_id = contextId;
  $bindOut.textContent = 'binding…';
  return api('/v1/hrr/bind', { method: 'POST', body: body }).then(function (out) {
    $bindOut.textContent = jsonText(out.data);
    if (out.data && out.data.context_id) {
      contextId = out.data.context_id;
    }
  }).catch(function (err) {
    $bindOut.textContent = String(err.message || err);
  });
}

function requestSignTransaction(unsignedTxB64) {
  return new Promise(function (resolve, reject) {
    var id = 'tx-' + (signSeq++);
    pendingSign[id] = { resolve: resolve, reject: reject };
    window.parent.postMessage({
      type: 'wallet-sign-transaction',
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

function showRailPicker(accepts, resume) {
  var rails = (accepts || []).filter(allowedRail);
  openModal('Choose a Solana rail', TWIN_NOTE + ' Pick a twin you can fund. The app will not silently take the first row.');
  $modalBody.innerHTML = '';
  if (!rails.length) {
    $modalBody.innerHTML = '<p>No allowed Solana rails in this 402. OpenZoo iOS only pays yUSDCx / wTOKENx / wLEOSx on solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp.</p>';
    $modalActions.innerHTML = '<button type="button" id="modal-cancel">CLOSE</button>';
    document.getElementById('modal-cancel').onclick = closeModal;
    return;
  }
  rails.forEach(function (row) {
    var meta = ALLOWED_RAILS[row.asset];
    var el = document.createElement('div');
    el.className = 'rail';
    el.innerHTML =
      '<strong></strong><div class="muted"></div><button type="button">PAY WITH THIS RAIL</button>';
    el.querySelector('strong').textContent = (row.extra && row.extra.symbol) || meta.symbol;
    el.querySelector('.muted').textContent =
      formatAmount(row) + '\n' + row.asset + '\n' + row.network +
      '\npayTo ' + row.payTo;
    el.querySelector('button').onclick = function () {
      confirmAndPay(row, resume);
    };
    $modalBody.appendChild(el);
  });
  $modalActions.innerHTML = '<button type="button" id="modal-cancel">CANCEL</button>';
  document.getElementById('modal-cancel').onclick = closeModal;
}

function confirmAndPay(row, resume) {
  if (!wallet.address) {
    openModal('Wallet required', 'Connect Phantom, Solflare, or the local burner in the shell first. OpenZoo will not fake a connected wallet.');
    $modalBody.innerHTML = '';
    $modalActions.innerHTML = '<button type="button" id="modal-cancel">CLOSE</button>';
    document.getElementById('modal-cancel').onclick = closeModal;
    return;
  }
  openModal('Building payment', 'POST /v1/pay/build is free. The gateway constructs the unsigned tx. This phone does not build the payment with web3.js.');
  $modalBody.textContent = 'asking the gateway…';
  api('/v1/pay/build', {
    method: 'POST',
    body: { accept: row, payer: wallet.address }
  }).then(function (out) {
    if (!out.res.ok) {
      throw new Error(typeof out.data === 'string' ? out.data : jsonText(out.data));
    }
    var built = out.data;
    openModal('Quote — sign, do not broadcast', TWIN_NOTE);
    $modalBody.innerHTML = '<div class="quote"><pre class="json"></pre></div>';
    $modalBody.querySelector('pre').textContent = jsonText({
      rail: (row.extra && row.extra.symbol) || ALLOWED_RAILS[row.asset].symbol,
      amount: formatAmount(row),
      asset: row.asset,
      network: row.network,
      payTo: row.payTo,
      feePayer: row.extra && row.extra.feePayer,
      payer: wallet.address,
      method: wallet.method,
      envelope: built.envelope
    });
    $modalActions.innerHTML =
      '<button type="button" id="modal-sign">SIGN WITH ' + String(wallet.method).toUpperCase() + '</button>' +
      '<button type="button" id="modal-cancel">CANCEL</button>';
    document.getElementById('modal-cancel').onclick = closeModal;
    document.getElementById('modal-sign').onclick = function () {
      $modalLead.textContent = 'Waiting for the shell to sign. Phantom/Solflare use signTransaction only — never signAndSendTransaction.';
      requestSignTransaction(built.transaction).then(function (signedTxB64) {
        closeModal();
        resume(encodePayment(built.envelope, signedTxB64));
      }).catch(function (err) {
        $modalLead.textContent = err.message || String(err);
      });
    };
  }).catch(function (err) {
    $modalLead.textContent = err.message || String(err);
    $modalBody.textContent = '';
    $modalActions.innerHTML = '<button type="button" id="modal-cancel">CLOSE</button>';
    document.getElementById('modal-cancel').onclick = closeModal;
  });
}

function chatHeaders(payment) {
  var headers = {};
  if (document.getElementById('attach-context').checked && contextId) {
    headers['X-HRR-Context'] = contextId;
  }
  if (payment) headers['X-PAYMENT'] = payment;
  return headers;
}

function sendChat(userText, payment) {
  if (!payment) {
    messages.push({ role: 'user', content: userText });
    addBubble('you', userText);
  }
  var body = {
    model: $model.value || DEFAULT_MODEL,
    messages: messages
  };
  return api('/v1/chat/completions', {
    method: 'POST',
    headers: chatHeaders(payment),
    body: body
  }).then(function (out) {
    if (out.res.status === 402) {
      addBubble('gateway', '402 — pick a Solana rail you can fund.');
      showRailPicker((out.data && out.data.accepts) || [], function (xPayment) {
        sendChat(userText, xPayment);
      });
      return;
    }
    if (isContextMissing(out.data, out.res.status)) {
      addBubble('gateway', 'context_not_found. Re-bind a corpus on the Bind tab. This is free — nothing was charged.', 'err');
      return;
    }
    if (!out.res.ok) {
      addBubble('gateway', typeof out.data === 'string' ? out.data : jsonText(out.data), 'err');
      return;
    }
    var choice = out.data && out.data.choices && out.data.choices[0];
    var reply = choice && choice.message && choice.message.content;
    if (!reply) reply = jsonText(out.data);
    messages.push({ role: 'assistant', content: reply });
    addBubble('openzoo', reply);
  }).catch(function (err) {
    addBubble('gateway', err.message || String(err), 'err');
  });
}

document.querySelectorAll('.tab').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('on'); });
    btn.classList.add('on');
    ['chat', 'bind', 'stats'].forEach(function (name) {
      document.getElementById('panel-' + name).classList.toggle('hidden', btn.getAttribute('data-tab') !== name);
    });
    if (btn.getAttribute('data-tab') === 'stats') refreshStats();
  });
});

document.getElementById('exit-btn').addEventListener('click', function () {
  window.parent.postMessage({ type: 'wallet-disconnect' }, '*');
});

document.getElementById('chat-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var text = $chatInput.value.trim();
  if (!text) return;
  $chatInput.value = '';
  sendChat(text);
});

document.getElementById('bind-btn').addEventListener('click', bindCorpus);
document.getElementById('stats-btn').addEventListener('click', refreshStats);
document.getElementById('corpus-file').addEventListener('change', function (ev) {
  var file = ev.target.files && ev.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    document.getElementById('corpus').value = String(reader.result || '');
  };
  reader.readAsText(file);
});

window.addEventListener('message', function (event) {
  if (event.source !== window.parent) return;
  var data = event.data;
  if (!data || !data.type) return;
  if (data.type === 'wallet-connected') {
    wallet.address = data.address;
    wallet.method = data.method;
    setWalletLabel();
  }
  if (data.type === 'wallet-disconnected') {
    wallet.address = null;
    wallet.method = null;
    setWalletLabel();
  }
  if (data.type === 'wallet-sign-transaction-response' && data.id && pendingSign[data.id]) {
    var waiter = pendingSign[data.id];
    delete pendingSign[data.id];
    if (data.error) waiter.reject(new Error(data.error));
    else waiter.resolve(data.signedTransaction);
  }
});

window.parent.postMessage({ type: 'wallet-request-info' }, '*');
setWalletLabel();
loadModels();
refreshStats();
