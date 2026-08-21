#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const occ = require('../www/js/occ.js');

assert.strictEqual(occ.OCC_ORIGIN, 'https://zoo.openzoo.fun');
assert.strictEqual(occ.OCC_BASE, 'https://zoo.openzoo.fun/occ');
assert.strictEqual(occ.OCC_PATHS.sessions, '/occ/sessions');
assert.strictEqual(occ.OCC_PATHS.messages('s1'), '/occ/sessions/s1/messages');
assert.strictEqual(occ.OCC_PATHS.files('s1'), '/occ/sessions/s1/files');
assert.strictEqual(occ.OCC_PATHS.stop('s1'), '/occ/sessions/s1/stop');
{
  const occSrc = fs.readFileSync(path.join(__dirname, '../www/js/occ.js'), 'utf8');
  assert.ok(!/headers\.ANTHROPIC_API_KEY\s*=/.test(occSrc));
  assert.ok(/delete headers\.ANTHROPIC_API_KEY/.test(occSrc));
}

assert.strictEqual(occ.canAgent(''), false);
assert.strictEqual(occ.canAgent(null), false);
assert.strictEqual(occ.canAgent('  '), false);
assert.strictEqual(occ.canAgent('oz_live'), true);

assert.throws(() => occ.requireKey(''), (err) => err.code === occ.NO_KEY);
assert.throws(() => occ.authHeaders(''), (err) => err.code === occ.NO_KEY);
assert.throws(() => occ.occUrl('https://evil.example/occ'), (err) => err.code === 'OCC_OPEN_URL');
assert.strictEqual(occ.occUrl('/occ/sessions'), 'https://zoo.openzoo.fun/occ/sessions');

const headers = occ.authHeaders('oz_secret', {
  'Content-Type': 'application/json',
  ANTHROPIC_API_KEY: 'sk-ant-leak',
  'x-api-key': 'nope'
});
assert.strictEqual(headers.Authorization, 'Bearer oz_secret');
assert.ok(!headers.ANTHROPIC_API_KEY);
assert.ok(!headers['x-api-key']);

assert.strictEqual(occ.sessionIdOf({ id: 'abc' }), 'abc');
assert.strictEqual(occ.sessionIdOf({ session_id: 'sid' }), 'sid');
assert.strictEqual(occ.sessionIdOf({ sessionId: 'camel' }), 'camel');

const sse = [
  'data: {"type":"status","status":"working"}',
  '',
  'data: {"type":"delta","text":"Hello"}',
  '',
  'data: {"choices":[{"delta":{"content":" world"}}]}',
  '',
  'data: {"type":"pty","data":"' + Buffer.from('\u001b[32mOK\u001b[0m').toString('base64') + '"}',
  '',
  'data: [DONE]',
  '',
  ''
].join('\n');
const events = [];
occ.consumeSse(sse, (ev) => events.push(ev));
assert.strictEqual(events[0].type, 'status');
assert.strictEqual(events[0].status, 'working');
assert.strictEqual(events[1].text, 'Hello');
assert.strictEqual(events[2].text, ' world');
assert.strictEqual(events[3].text, 'OK');
assert.strictEqual(events[4].type, 'done');
assert.ok(events.every((ev) => !/RUN:/.test(JSON.stringify(ev))));

assert.strictEqual(occ.stripAnsi('\u001b[31mred\u001b[0m'), 'red');
assert.strictEqual(occ.eventFromPayload({ type: 'done' }).type, 'done');
assert.strictEqual(occ.extractText({ choices: [{ message: { content: 'hi' } }] }), 'hi');

function mockFetch(plan) {
  return function (url, init) {
    const hit = plan.shift();
    assert.ok(hit, 'unexpected fetch ' + url);
    assert.strictEqual(url, hit.url);
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
      text: () => Promise.resolve(hit.text),
      body: null
    });
  };
}

return occ.createSession('oz_key', { threadId: 't-1' }, mockFetch([
  {
    url: 'https://zoo.openzoo.fun/occ/sessions',
    status: 200,
    text: JSON.stringify({ id: 'sess-1' })
  }
])).then((id) => {
  assert.strictEqual(id, 'sess-1');
  return occ.sendMessage('oz_key', 'sess-1', '/goal ship the box', null, {
    fetch: mockFetch([
      {
        url: 'https://zoo.openzoo.fun/occ/sessions/sess-1/messages',
        status: 200,
        ctype: 'text/event-stream',
        text: 'data: {"text":"working on it"}\n\n',
        expectBody: { text: '/goal ship the box', stream: true }
      }
    ])
  });
}).then((out) => {
  assert.strictEqual(out.reply, 'working on it');
  return occ.uploadFile('oz_key', 'sess-1', { name: 'note.txt', text: 'hello' }, mockFetch([
    {
      url: 'https://zoo.openzoo.fun/occ/sessions/sess-1/files',
      status: 200,
      text: JSON.stringify({ path: 'note.txt' })
    }
  ]));
}).then((up) => {
  assert.strictEqual(up.path, 'note.txt');
  return occ.createSession('oz_key', {}, mockFetch([
    {
      url: 'https://zoo.openzoo.fun/occ/sessions',
      status: 404,
      text: '<!DOCTYPE html><html></html>'
    }
  ])).then(() => {
    throw new Error('expected missing route');
  }, (err) => {
    assert.strictEqual(err.code, occ.MISSING);
  });
}).then(() => occ.sendMessage('', 'sess-1', 'hi').then(() => {
  throw new Error('expected no key');
}, (err) => {
  assert.strictEqual(err.code, occ.NO_KEY);
})).then(() => occ.createSession('oz_key', {}, mockFetch([
  {
    url: 'https://zoo.openzoo.fun/occ/sessions',
    status: 401,
    text: JSON.stringify({ error: 'no' })
  }
])).then(() => {
  throw new Error('expected refused');
}, (err) => {
  assert.strictEqual(err.code, occ.REFUSED);
})).then(() => {
  const src = fs.readFileSync(path.join(__dirname, '../www/js/occ.js'), 'utf8');
  assert.ok(src.indexOf('Authorization') !== -1);
  assert.ok(src.indexOf('Bearer ') !== -1);
  assert.ok(src.indexOf('ANTHROPIC_API_KEY') !== -1);
  assert.ok(/delete headers\.ANTHROPIC_API_KEY/.test(src));
  assert.ok(src.indexOf('parseRun') === -1);
  assert.ok(!/parseRun|RUN:\s*\$|function parseRun/.test(src));

  const app = fs.readFileSync(path.join(__dirname, '../www/app/app.js'), 'utf8');
  assert.ok(app.indexOf('OpenZooIde') !== -1);
  assert.ok(app.indexOf('openCloudAgent') !== -1);
  assert.ok(app.indexOf('OpenZooOcc.createSession') === -1);
  assert.ok(app.indexOf('OpenZooOcc.sendMessage') === -1);
  assert.ok(app.indexOf("var GATEWAY = 'https://x402-tokens.fly.dev'") !== -1);
  assert.ok(app.indexOf('OpenZooChatSpill.buildChatRequest') !== -1);
  assert.ok(app.indexOf('parseRun') === -1);
  assert.ok(app.indexOf('ANTHROPIC_API_KEY') === -1);
  assert.ok(app.indexOf('/api/occ') === -1);

  const html = fs.readFileSync(path.join(__dirname, '../www/app/index.html'), 'utf8');
  assert.ok(html.indexOf('js/occ.js') !== -1);
  assert.ok(html.indexOf('id="modeToggle"') !== -1);
  assert.ok(html.indexOf('id="modeAgent"') !== -1);
  assert.ok(html.indexOf('id="goalTip"') !== -1);
  assert.ok(html.indexOf('id="actStop"') !== -1);
  assert.ok(html.indexOf('https://zoo.openzoo.fun') !== -1);

  const shell = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');
  assert.ok(shell.indexOf('https://zoo.openzoo.fun') !== -1);
  assert.ok(!/ANTHROPIC_API_KEY/.test(shell));

  console.log('occ: ok');
  console.log('  Bearer required; no key → no Agent');
  console.log('  zoo.openzoo.fun/occ sessions + messages + files');
  console.log('  SSE paints OCC text, not a RUN: parser');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
