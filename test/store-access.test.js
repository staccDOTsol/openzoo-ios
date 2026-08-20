#!/usr/bin/env node
'use strict';

const assert = require('assert');
const store = require('../www/js/store-ios.js');
const hook = require('../hooks/ios-swift-version.js');

assert.strictEqual(store.hasAccess(null), false);
assert.strictEqual(store.hasAccess({}), false);
assert.strictEqual(store.hasAccess({ localUnlock: true }), false);
assert.strictEqual(store.hasAccess({ localUnlock: true }, { debug: false }), false);
assert.strictEqual(store.hasAccess({ localUnlock: true }, { debug: true }), true);
assert.strictEqual(store.hasAccess({ productId: 'fun.openzoo.ios.sub.pro' }), true);
assert.strictEqual(store.hasAccess({ jws: 'jws' }, { debug: false }), true);
assert.strictEqual(store.hasAccess({ key: 'k' }), true);

const applied = store.applyLocalUnlock({ pending: false });
assert.strictEqual(applied.localUnlock, true);
assert.strictEqual(applied.tier, 'dev');
assert.ok(!applied.productId);
assert.ok(!applied.key);
assert.ok(!store.hasAccess(applied));
assert.ok(store.hasAccess(applied, { debug: true }));

const emptySwift = [
  'isa = XCBuildConfiguration;',
  '\t\t\tbuildSettings = {',
  '\t\t\t\tSWIFT_VERSION = ;',
  '\t\t\t};',
  '\t\t\tname = Debug;'
].join('\n');
const patchedDebug = hook.patchPbxproj(emptySwift);
assert.ok(/SWIFT_VERSION = 5\.0;/.test(patchedDebug));
assert.ok(/SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG/.test(patchedDebug));

const release = [
  'isa = XCBuildConfiguration;',
  '\t\t\tbuildSettings = {',
  '\t\t\t\tPRODUCT_NAME = OpenZoo;',
  '\t\t\t};',
  '\t\t\tname = Release;'
].join('\n');
const patchedRelease = hook.patchPbxproj(release);
assert.ok(/SWIFT_VERSION = 5\.0;/.test(patchedRelease));
assert.ok(!/SWIFT_ACTIVE_COMPILATION_CONDITIONS/.test(patchedRelease));

const fs = require('fs');
const path = require('path');
const swift = fs.readFileSync(path.join(__dirname, '../cordova-plugin-openzoo-store/src/ios/OpenZooStore.swift'), 'utf8');
assert.ok(/#if DEBUG/.test(swift));
assert.ok(/#available\(iOS 16\.0, \*\)/.test(swift));
assert.ok(/transaction\.environment/.test(swift));
assert.ok(!/x402/.test(swift));

const shell = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');
assert.ok(shell.indexOf('id="dev-unlock"') !== -1);
assert.ok(shell.indexOf('id="dev-email"') !== -1);
assert.ok(!/x402 escape|Connect Phantom|Use local burner/.test(shell.split('id="paywall"')[1].split('id="advanced"')[0]));

console.log('store-access: ok');
