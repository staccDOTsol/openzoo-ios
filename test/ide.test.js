#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ide = require('../www/js/ide.js');

assert.strictEqual(ide.IDE_ORIGIN, 'https://zoo.openzoo.fun');
assert.strictEqual(ide.IDE_PATH, '/api/ide/session');
assert.strictEqual(ide.ideUrl(), 'https://zoo.openzoo.fun/api/ide/session');
assert.strictEqual(ide.ideUrl('/api/ide/session'), 'https://zoo.openzoo.fun/api/ide/session');
assert.throws(() => ide.ideUrl('https://evil.example/api/ide/session'), (err) => err.code === ide.OPEN_URL);
{
  const ideSrc = fs.readFileSync(path.join(__dirname, '../www/js/ide.js'), 'utf8');
  assert.ok(!/['"`]\/api\/occ/.test(ideSrc));
  assert.ok(ideSrc.indexOf("IDE_PATH = '/api/ide/session'") !== -1);
}

{
  const src = fs.readFileSync(path.join(__dirname, '../www/js/ide.js'), 'utf8');
  assert.ok(!/headers\.ANTHROPIC_API_KEY\s*=/.test(src));
  assert.ok(/delete headers\.ANTHROPIC_API_KEY/.test(src));
  assert.ok(src.indexOf('Authorization') !== -1);
  assert.ok(src.indexOf('Bearer ') !== -1);
  assert.ok(src.indexOf('/api/ide/session') !== -1);
  assert.ok(!/['"`]\/api\/occ/.test(src));
}

assert.strictEqual(ide.canAgent(''), false);
assert.strictEqual(ide.canAgent(null), false);
assert.strictEqual(ide.canAgent('  '), false);
assert.strictEqual(ide.canAgent('oz_live'), true);
assert.throws(() => ide.requireKey(''), (err) => err.code === ide.NO_KEY);
assert.throws(() => ide.authHeaders(''), (err) => err.code === ide.NO_KEY);

const headers = ide.authHeaders('oz_secret', {
  'Content-Type': 'application/json',
  ANTHROPIC_API_KEY: 'sk-ant-leak',
  'x-api-key': 'nope'
});
assert.strictEqual(headers.Authorization, 'Bearer oz_secret');
assert.ok(!headers.ANTHROPIC_API_KEY);
assert.ok(!headers['x-api-key']);

assert.strictEqual(ide.assertSessionUrl('/ide/s1'), 'https://zoo.openzoo.fun/ide/s1');
assert.strictEqual(ide.assertSessionUrl('https://zoo.openzoo.fun/ide/s1'), 'https://zoo.openzoo.fun/ide/s1');
assert.strictEqual(ide.assertSessionUrl('https://box.openzoo.fun/'), 'https://box.openzoo.fun/');
assert.throws(() => ide.assertSessionUrl('https://evil.example/ide'), (err) => err.code === ide.OPEN_URL);
assert.throws(() => ide.assertSessionUrl('http://zoo.openzoo.fun/ide'), (err) => err.code === ide.OPEN_URL);
assert.throws(() => ide.assertSessionUrl('javascript:alert(1)'), (err) => err.code === ide.OPEN_URL);

const session = ide.sessionOf({ url: '/ide/live', password: 'pw', id: 'sess-1' });
assert.strictEqual(session.url, 'https://zoo.openzoo.fun/ide/live');
assert.strictEqual(session.password, 'pw');
assert.strictEqual(session.id, 'sess-1');

function mockFetch(plan) {
  return function (url, init) {
    const hit = plan.shift();
    assert.ok(hit, 'unexpected fetch ' + url);
    assert.strictEqual(url, hit.url);
    assert.strictEqual(init.method, hit.method);
    assert.strictEqual(init.headers.Authorization, 'Bearer oz_key');
    assert.ok(!init.headers.ANTHROPIC_API_KEY);
    if (hit.expectBody) {
      const body = JSON.parse(init.body);
      Object.keys(hit.expectBody).forEach((k) => {
        assert.strictEqual(body[k], hit.expectBody[k]);
      });
    }
    return Promise.resolve({
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      headers: { get: () => hit.ctype || 'application/json' },
      text: () => Promise.resolve(hit.text)
    });
  };
}

return ide.openSession('oz_key', mockFetch([
  {
    url: 'https://zoo.openzoo.fun/api/ide/session',
    method: 'GET',
    status: 200,
    text: JSON.stringify({ url: 'https://zoo.openzoo.fun/ide/running', id: 'running' })
  }
])).then((got) => {
  assert.strictEqual(got.url, 'https://zoo.openzoo.fun/ide/running');
  assert.strictEqual(got.id, 'running');
  return ide.openSession('oz_key', mockFetch([
    {
      url: 'https://zoo.openzoo.fun/api/ide/session',
      method: 'GET',
      status: 404,
      text: JSON.stringify({ error: 'no session' })
    },
    {
      url: 'https://zoo.openzoo.fun/api/ide/session',
      method: 'POST',
      status: 200,
      text: JSON.stringify({ url: '/ide/new', password: 'secret', id: 'new-1' }),
      expectBody: {}
    }
  ]));
}).then((created) => {
  assert.strictEqual(created.url, 'https://zoo.openzoo.fun/ide/new');
  assert.strictEqual(created.password, 'secret');
  assert.strictEqual(created.id, 'new-1');
  return ide.openSession('oz_key', mockFetch([
    {
      url: 'https://zoo.openzoo.fun/api/ide/session',
      method: 'GET',
      status: 404,
      text: '<!DOCTYPE html><html></html>'
    }
  ])).then(() => {
    throw new Error('expected missing route');
  }, (err) => {
    assert.strictEqual(err.code, ide.MISSING);
    assert.strictEqual(err.message, ide.NOT_LIVE);
    assert.ok(err.html);
  });
}).then(() => ide.openSession('oz_key', mockFetch([
  {
    url: 'https://zoo.openzoo.fun/api/ide/session',
    method: 'GET',
    status: 401,
    text: JSON.stringify({ error: 'no' })
  }
])).then(() => {
  throw new Error('expected refused');
}, (err) => {
  assert.strictEqual(err.code, ide.REFUSED);
})).then(() => ide.openSession('', mockFetch([])).then(() => {
  throw new Error('expected no key');
}, (err) => {
  assert.strictEqual(err.code, ide.NO_KEY);
})).then(() => ide.createSession('oz_key', mockFetch([
  {
    url: 'https://zoo.openzoo.fun/api/ide/session',
    method: 'POST',
    status: 200,
    text: JSON.stringify({ url: 'https://evil.example/open' }),
    expectBody: {}
  }
])).then(() => {
  throw new Error('expected open url');
}, (err) => {
  assert.strictEqual(err.code, ide.OPEN_URL);
})).then(() => {
  assert.ok(/toolbar=no/.test(ide.IAB_FEATURES));
  assert.ok(/location=no/.test(ide.IAB_FEATURES));
  assert.ok(!/toolbar=yes/.test(ide.IAB_FEATURES));

  const loaded = ide.loadSession({
    url: 'https://zoo.openzoo.fun/ide/live',
    password: 'pw',
    id: 's1'
  }, { frame: { src: '' } });
  assert.strictEqual(loaded.target, 'iframe');
  assert.strictEqual(loaded.frame.src, 'https://zoo.openzoo.fun/ide/live');
  assert.strictEqual(loaded.password, 'pw');

  let iabOpened = false;
  global.cordova = {
    InAppBrowser: {
      open: function () {
        iabOpened = true;
        return { close: function () {} };
      }
    }
  };
  const preferFrame = ide.loadSession({
    url: 'https://zoo.openzoo.fun/ide/live',
    id: 's1'
  }, { frame: { src: '' } });
  assert.strictEqual(preferFrame.target, 'iframe');
  assert.strictEqual(iabOpened, false);

  const iab = ide.loadSession({
    url: 'https://zoo.openzoo.fun/ide/live',
    id: 's1'
  }, {});
  assert.strictEqual(iab.target, 'inappbrowser');
  assert.strictEqual(iabOpened, true);
  delete global.cordova;

  const app = fs.readFileSync(path.join(__dirname, '../www/app/app.js'), 'utf8');
  assert.ok(app.indexOf('OpenZooIde') !== -1);
  assert.ok(app.indexOf('openCloudAgent') !== -1);
  assert.ok(app.indexOf('/api/ide/session') !== -1);
  assert.ok(app.indexOf('OpenZooOcc.createSession') === -1);
  assert.ok(app.indexOf('OpenZooOcc.sendMessage') === -1);
  assert.ok(app.indexOf("var GATEWAY = 'https://x402-tokens.fly.dev'") !== -1);
  assert.ok(app.indexOf('OpenZooChatSpill.buildChatRequest') !== -1);
  assert.ok(app.indexOf('ANTHROPIC_API_KEY') === -1);
  assert.ok(app.indexOf('/api/occ') === -1);

  const html = fs.readFileSync(path.join(__dirname, '../www/app/index.html'), 'utf8');
  assert.ok(html.indexOf('js/ide.js') !== -1);
  assert.ok(html.indexOf('id="agentFrame"') !== -1);
  assert.ok(html.indexOf('id="modeAgent"') !== -1);
  assert.ok(html.indexOf('https://zoo.openzoo.fun') !== -1);
  assert.ok(/frame-src[^"]*https:\/\/zoo\.openzoo\.fun/.test(html));
  assert.ok(html.indexOf('viewport-fit=cover') !== -1);

  const css = fs.readFileSync(path.join(__dirname, '../www/app/app.css'), 'utf8');
  assert.ok(/#agentFrame\s*\{[^}]*width:\s*100%/.test(css));
  assert.ok(/#agentFrame\s*\{[^}]*height:\s*100%/.test(css));
  assert.ok(/body\.agent-mode #bar/.test(css));
  assert.ok(!/toolbar=yes/.test(fs.readFileSync(path.join(__dirname, '../www/js/ide.js'), 'utf8')));

  const shell = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');
  assert.ok(shell.indexOf('https://zoo.openzoo.fun') !== -1);
  assert.ok(!/ANTHROPIC_API_KEY/.test(shell));

  const widget = fs.readFileSync(path.join(__dirname, '../config.xml'), 'utf8');
  assert.ok(widget.indexOf('allow-navigation') !== -1);
  assert.ok(widget.indexOf('https://zoo.openzoo.fun/*') !== -1);

  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  assert.ok(readme.indexOf('/api/ide/session') !== -1);
  assert.ok(readme.indexOf('POST /ide/session') === -1);
  assert.ok(readme.indexOf('ANTHROPIC_API_KEY') !== -1);
  assert.ok(/IAP|StoreKit|IAP-only|IAP only/.test(readme));

  console.log('ide: ok');
  console.log('  Bearer required; no key → no Agent');
  console.log('  zoo.openzoo.fun/api/ide/session GET + POST');
  console.log('  load url full-bleed in iframe; IAB fallback has no toolbar');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
