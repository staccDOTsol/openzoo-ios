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
assert.strictEqual(store.hasAccess({ localUnlock: true }, { testFlight: false }), false);
assert.strictEqual(store.hasAccess({ localUnlock: true }, { testFlight: true }), true);
assert.strictEqual(store.hasAccess({ localUnlock: true }, { debug: false, testFlight: false }), false);
assert.strictEqual(store.hasAccess({ productId: 'fun.openzoo.ios.sub.pro' }), true);
assert.strictEqual(store.hasAccess({ jws: 'jws' }, { debug: false }), true);
assert.strictEqual(store.hasAccess({ key: 'k' }), true);
assert.ok(typeof store.testFlight === 'function');

const applied = store.applyLocalUnlock({ pending: false });
assert.strictEqual(applied.localUnlock, true);
assert.strictEqual(applied.tier, 'dev');
assert.ok(!applied.productId);
assert.ok(!applied.key);
assert.ok(!store.hasAccess(applied));
assert.ok(store.hasAccess(applied, { debug: true }));
assert.ok(store.hasAccess(applied, { testFlight: true }));
assert.ok(!store.hasAccess(applied, { debug: false, testFlight: false }));

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
assert.ok(/func testFlight/.test(swift));
assert.ok(/sandboxReceipt/.test(swift));
assert.ok(/isCancel/.test(swift));
assert.ok(/userCancelled/.test(swift));
const withoutDebug = swift.replace(/#if DEBUG[\s\S]*?#endif/g, '');
assert.ok(!/jarettrsdunn1999@gmail\.com/.test(withoutDebug));
assert.ok(/jarettrsdunn1999@gmail\.com/.test(swift));

const pluginJs = fs.readFileSync(path.join(__dirname, '../cordova-plugin-openzoo-store/www/openzoo-store.js'), 'utf8');
assert.ok(/testFlight/.test(pluginJs));

const shell = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');
assert.ok(shell.indexOf('id="dev-unlock"') !== -1);
assert.ok(shell.indexOf('id="dev-email"') !== -1);
assert.ok(shell.indexOf('OpenZooIOSStore.testFlight()') !== -1);
assert.ok(shell.indexOf('persistLocalUnlockAndEnter()') !== -1);
assert.ok(shell.indexOf('No App Store subscription to restore.') !== -1);
assert.ok(!/throw new Error\('No App Store subscription to restore\.'\)/.test(shell));
assert.ok(!/x402 escape|Connect Phantom|Use local burner/.test(shell.split('id="paywall"')[1].split('id="advanced"')[0]));

const widget = fs.readFileSync(path.join(__dirname, '../config.xml'), 'utf8');
assert.ok(/id="fun\.openzoo\.ios"/.test(widget));
assert.ok(/version="1\.0\.1"/.test(widget));
assert.ok(/ios-CFBundleVersion="2"/.test(widget));

const build = JSON.parse(fs.readFileSync(path.join(__dirname, '../build.json'), 'utf8'));
assert.strictEqual(build.ios.debug.codeSignIdentity, 'Apple Development');
assert.strictEqual(build.ios.debug.packageType, 'development');
assert.strictEqual(build.ios.debug.developmentTeam, '38DS45YWYM');
assert.strictEqual(build.ios.debug.automaticProvisioning, true);
assert.strictEqual(build.ios.release.codeSignIdentity, 'Apple Distribution');
assert.strictEqual(build.ios.release.packageType, 'app-store');
assert.strictEqual(build.ios.release.developmentTeam, '38DS45YWYM');
assert.strictEqual(build.ios.release.automaticProvisioning, true);

console.log('store-access: ok');
