/* iOS wallet: Phantom + Solflare deeplinks, or a local Ed25519 burner. Never MWA. */
(function (root) {
  'use strict';

  var STORAGE_PREFIX = 'openzoo.';
  var BURNER_KEY = 'burnerSecretB58';
  var DAPP_SECRET_KEY = 'dappBoxSecretB58';

  var PROVIDERS = {
    phantom: {
      method: 'phantom',
      name: 'Phantom',
      connectUrl: 'https://phantom.app/ul/v1/connect',
      signTxUrl: 'https://phantom.app/ul/v1/signTransaction',
      signMsgUrl: 'https://phantom.app/ul/v1/signMessage',
      probe: 'phantom://app',
      encPubField: 'phantom_encryption_public_key',
      redirect: 'openzoo://phantom'
    },
    solflare: {
      method: 'solflare',
      name: 'Solflare',
      connectUrl: 'https://solflare.com/ul/v1/connect',
      signTxUrl: 'https://solflare.com/ul/v1/signTransaction',
      signMsgUrl: 'https://solflare.com/ul/v1/signMessage',
      probe: 'solflare://',
      encPubField: 'solflare_encryption_public_key',
      redirect: 'openzoo://solflare'
    }
  };

  function lsGet(k) {
    try { return localStorage.getItem(STORAGE_PREFIX + k); } catch (_) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(STORAGE_PREFIX + k, v); } catch (_) {}
  }
  function lsDel(k) {
    try { localStorage.removeItem(STORAGE_PREFIX + k); } catch (_) {}
  }

  function pluginReady() {
    return !!(root.OpenZooWallet && typeof root.OpenZooWallet.storeSecret === 'function');
  }

  function storeSecret(key, value) {
    return new Promise(function (resolve, reject) {
      if (pluginReady()) {
        root.OpenZooWallet.storeSecret(key, value, function () {
          resolve('keychain');
        }, function (err) { reject(new Error(err || 'Keychain store failed')); });
        return;
      }
      lsSet(key, value);
      resolve('localStorage');
    });
  }

  function loadSecret(key) {
    return new Promise(function (resolve, reject) {
      if (pluginReady()) {
        root.OpenZooWallet.loadSecret(key, function (value) {
          resolve(value || '');
        }, function (err) { reject(new Error(err || 'Keychain load failed')); });
        return;
      }
      resolve(lsGet(key) || '');
    });
  }

  function canOpen(url) {
    return new Promise(function (resolve) {
      if (!pluginReady()) {
        resolve({ installed: null, reason: 'plugin-unavailable' });
        return;
      }
      root.OpenZooWallet.canOpenURL(url, function (result) {
        resolve({ installed: !!(result && result.installed) });
      }, function () {
        resolve({ installed: null, reason: 'canOpenURL-failed' });
      });
    });
  }

  function openExternal(url) {
    return new Promise(function (resolve, reject) {
      if (pluginReady()) {
        root.OpenZooWallet.openURL(url, function () { resolve(); }, function (err) {
          reject(new Error(err || 'Could not open URL'));
        });
        return;
      }
      var opened = root.open(url, '_system');
      if (opened === null) {
        reject(new Error('Could not open URL from this environment'));
        return;
      }
      resolve();
    });
  }

  function persistSession(state) {
    if (state.address) lsSet('address', state.address);
    if (state.method) lsSet('method', state.method);
    if (state.session) lsSet('session', state.session);
    if (state.sharedSecretB58) lsSet('sharedSecretB58', state.sharedSecretB58);
    if (state.dappPublicB58) lsSet('dappPublicB58', state.dappPublicB58);
    if (state.pending) lsSet('pending', JSON.stringify(state.pending));
    else lsDel('pending');
  }

  function loadPersisted() {
    var pendingRaw = lsGet('pending');
    var pending = null;
    if (pendingRaw) {
      try { pending = JSON.parse(pendingRaw); } catch (_) { pending = null; }
    }
    return {
      address: lsGet('address'),
      method: lsGet('method'),
      session: lsGet('session'),
      sharedSecretB58: lsGet('sharedSecretB58'),
      dappPublicB58: lsGet('dappPublicB58'),
      pending: pending
    };
  }

  function clearDeeplinkSession() {
    lsDel('address');
    lsDel('method');
    lsDel('session');
    lsDel('sharedSecretB58');
    lsDel('dappPublicB58');
    lsDel('pending');
  }

  function ensureDappKeyPair() {
    return loadSecret(DAPP_SECRET_KEY).then(function (stored) {
      var pair;
      if (stored) {
        pair = nacl.box.keyPair.fromSecretKey(bs58.decode(stored));
      } else {
        pair = nacl.box.keyPair();
      }
      return storeSecret(DAPP_SECRET_KEY, bs58.encode(pair.secretKey)).then(function () {
        return pair;
      });
    });
  }

  function sharedSecretFrom(theirPubB58, dappSecret) {
    return nacl.box.before(bs58.decode(theirPubB58), dappSecret);
  }

  function connectDeeplink(providerId) {
    var provider = PROVIDERS[providerId];
    if (!provider) return Promise.reject(new Error('Unknown wallet'));
    return canOpen(provider.probe).then(function (probe) {
      if (probe.installed === false) {
        throw new Error(provider.name + ' is not installed on this phone.');
      }
      return ensureDappKeyPair().then(function (pair) {
        persistSession({
          pending: { kind: 'connect', provider: providerId },
          dappPublicB58: bs58.encode(pair.publicKey)
        });
        var params = new URLSearchParams({
          app_url: 'https://github.com/staccDOTsol/openzoo-ios',
          dapp_encryption_public_key: bs58.encode(pair.publicKey),
          redirect_link: provider.redirect,
          cluster: 'mainnet-beta'
        });
        var url = provider.connectUrl + '?' + params.toString();
        if (probe.installed === null) {
          return openExternal(url).then(function () {
            return {
              opened: true,
              warning: 'Cannot verify ' + provider.name + ' is installed from this environment. If it is missing, the system will open a website — we will not claim a wallet we cannot reach.'
            };
          });
        }
        return openExternal(url).then(function () { return { opened: true }; });
      });
    });
  }

  function signTransactionDeeplink(unsignedTxB64, requestId) {
    var persisted = loadPersisted();
    var provider = PROVIDERS[persisted.method];
    if (!provider || !persisted.session || !persisted.sharedSecretB58) {
      return Promise.reject(new Error('No deeplink wallet session. Connect Phantom or Solflare first.'));
    }
    return canOpen(provider.probe).then(function (probe) {
      if (probe.installed === false) {
        throw new Error(provider.name + ' is not installed on this phone.');
      }
      return ensureDappKeyPair().then(function (pair) {
        var shared = bs58.decode(persisted.sharedSecretB58);
        var txB58 = bs58.encode(OpenZooCrypto.base64ToBytes(unsignedTxB64));
        var enc = OpenZooCrypto.encryptPayload({
          transaction: txB58,
          session: persisted.session
        }, shared);
        persistSession({
          pending: { kind: 'sign-tx', provider: persisted.method, id: requestId }
        });
        var params = new URLSearchParams({
          dapp_encryption_public_key: bs58.encode(pair.publicKey),
          nonce: bs58.encode(enc.nonce),
          redirect_link: provider.redirect,
          payload: bs58.encode(enc.bytes)
        });
        return openExternal(provider.signTxUrl + '?' + params.toString());
      });
    });
  }

  function signMessageDeeplink(message, requestId) {
    var persisted = loadPersisted();
    var provider = PROVIDERS[persisted.method];
    if (!provider || !persisted.session || !persisted.sharedSecretB58) {
      return Promise.reject(new Error('No deeplink wallet session. Connect Phantom or Solflare first.'));
    }
    return canOpen(provider.probe).then(function (probe) {
      if (probe.installed === false) {
        throw new Error(provider.name + ' is not installed on this phone.');
      }
      return ensureDappKeyPair().then(function (pair) {
        var shared = bs58.decode(persisted.sharedSecretB58);
        var enc = OpenZooCrypto.encryptPayload({
          message: bs58.encode(new TextEncoder().encode(message)),
          session: persisted.session,
          display: 'utf8'
        }, shared);
        persistSession({
          pending: { kind: 'sign-msg', provider: persisted.method, id: requestId }
        });
        var params = new URLSearchParams({
          dapp_encryption_public_key: bs58.encode(pair.publicKey),
          nonce: bs58.encode(enc.nonce),
          redirect_link: provider.redirect,
          payload: bs58.encode(enc.bytes)
        });
        return openExternal(provider.signMsgUrl + '?' + params.toString());
      });
    });
  }

  function handleRedirectUrl(urlString) {
    if (!urlString || urlString.indexOf('openzoo://') !== 0) return Promise.resolve(null);
    var url;
    try {
      url = new URL(urlString);
    } catch (_) {
      return Promise.reject(new Error('Malformed wallet redirect'));
    }
    var params = url.searchParams;
    if (params.get('errorCode') || params.get('errorMessage')) {
      lsDel('pending');
      return Promise.reject(new Error(params.get('errorMessage') || ('Wallet error ' + params.get('errorCode'))));
    }
    var host = (url.hostname || url.host || '').toLowerCase();
    var providerId = host === 'solflare' ? 'solflare' : 'phantom';
    var provider = PROVIDERS[providerId];
    var pending = loadPersisted().pending || { kind: 'connect', provider: providerId };

    return ensureDappKeyPair().then(function (pair) {
      var theirPub = params.get(provider.encPubField);
      var persisted = loadPersisted();
      var shared;
      if (theirPub) {
        shared = sharedSecretFrom(theirPub, pair.secretKey);
      } else if (persisted.sharedSecretB58) {
        shared = bs58.decode(persisted.sharedSecretB58);
      } else {
        throw new Error('Missing wallet encryption public key');
      }
      var data = params.get('data');
      var nonce = params.get('nonce');
      if (!data || !nonce) throw new Error('Wallet redirect missing data/nonce');
      var opened = OpenZooCrypto.decryptPayload(data, nonce, shared);

      if (pending.kind === 'connect') {
        if (!opened.public_key || !opened.session) {
          throw new Error('Wallet connect payload missing public_key/session');
        }
        persistSession({
          address: opened.public_key,
          method: provider.method,
          session: opened.session,
          sharedSecretB58: bs58.encode(shared),
          dappPublicB58: bs58.encode(pair.publicKey),
          pending: null
        });
        return {
          type: 'connected',
          address: opened.public_key,
          method: provider.method
        };
      }

      if (pending.kind === 'sign-tx') {
        if (!opened.transaction) throw new Error('Wallet did not return a signed transaction');
        lsDel('pending');
        return {
          type: 'signed-tx',
          id: pending.id,
          signedTransaction: OpenZooCrypto.bytesToBase64(bs58.decode(opened.transaction))
        };
      }

      if (pending.kind === 'sign-msg') {
        lsDel('pending');
        return {
          type: 'signed-msg',
          id: pending.id,
          signature: opened.signature
        };
      }

      throw new Error('Unexpected wallet redirect');
    });
  }

  function createBurner() {
    var pair = nacl.sign.keyPair();
    var secretB58 = bs58.encode(pair.secretKey);
    var address = bs58.encode(pair.publicKey);
    return storeSecret(BURNER_KEY, secretB58).then(function (where) {
      persistSession({
        address: address,
        method: 'burner',
        pending: null
      });
      return {
        address: address,
        method: 'burner',
        storage: where,
        disclaimer: 'Local disposable key on this phone. We never custody it. We do not sell crypto. You fund it yourself.'
      };
    });
  }

  function loadBurner() {
    return loadSecret(BURNER_KEY).then(function (secretB58) {
      if (!secretB58) return null;
      var secret = bs58.decode(secretB58);
      var pair = nacl.sign.keyPair.fromSecretKey(secret);
      return {
        address: bs58.encode(pair.publicKey),
        method: 'burner',
        secretKey: secret
      };
    });
  }

  function connectBurner() {
    return loadBurner().then(function (existing) {
      if (existing) {
        persistSession({ address: existing.address, method: 'burner', pending: null });
        return {
          address: existing.address,
          method: 'burner',
          storage: pluginReady() ? 'keychain' : 'localStorage',
          disclaimer: 'Local disposable key on this phone. We never custody it. We do not sell crypto. You fund it yourself.'
        };
      }
      return createBurner();
    });
  }

  function signTransactionBurner(unsignedTxB64) {
    return loadBurner().then(function (burner) {
      if (!burner) throw new Error('No local burner key on this phone');
      var signed = OpenZooCrypto.partialSignTx(
        OpenZooCrypto.base64ToBytes(unsignedTxB64),
        burner.secretKey
      );
      return { signedTransaction: OpenZooCrypto.bytesToBase64(signed) };
    });
  }

  function signMessageBurner(message) {
    return loadBurner().then(function (burner) {
      if (!burner) throw new Error('No local burner key on this phone');
      var sig = nacl.sign.detached(new TextEncoder().encode(message), burner.secretKey);
      return { signature: bs58.encode(sig) };
    });
  }

  root.OpenZooIOSWallet = {
    PROVIDERS: PROVIDERS,
    pluginReady: pluginReady,
    canOpen: canOpen,
    connectDeeplink: connectDeeplink,
    signTransactionDeeplink: signTransactionDeeplink,
    signMessageDeeplink: signMessageDeeplink,
    handleRedirectUrl: handleRedirectUrl,
    connectBurner: connectBurner,
    createBurner: createBurner,
    loadBurner: loadBurner,
    signTransactionBurner: signTransactionBurner,
    signMessageBurner: signMessageBurner,
    loadPersisted: loadPersisted,
    clearDeeplinkSession: clearDeeplinkSession,
    BURNER_DISCLAIMER: 'Local disposable key on this phone. We never custody it. We do not sell crypto. You fund it yourself.'
  };
})(typeof window !== 'undefined' ? window : globalThis);
