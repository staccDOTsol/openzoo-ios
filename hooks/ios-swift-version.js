#!/usr/bin/env node
/* Pin SWIFT_VERSION so cordova build ios --device compiles the StoreKit plugin. */
'use strict';

const fs = require('fs');
const path = require('path');

function findPbxproj(root) {
  const ios = path.join(root, 'platforms', 'ios');
  if (!fs.existsSync(ios)) return null;
  const names = fs.readdirSync(ios);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name.endsWith('.xcodeproj')) continue;
    const file = path.join(ios, name, 'project.pbxproj');
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function patchPbxproj(src) {
  let next = src.replace(/SWIFT_VERSION = ?;/g, 'SWIFT_VERSION = 5.0;');
  next = next.replace(
    /isa = XCBuildConfiguration;[\s\S]*?name = (Debug|Release);/g,
    function (block, name) {
      let patched = block.replace(/SWIFT_VERSION = [^;]*;/, 'SWIFT_VERSION = 5.0;');
      if (!/SWIFT_VERSION = /.test(patched)) {
        patched = patched.replace(
          /buildSettings = \{/,
          'buildSettings = {\n\t\t\t\tSWIFT_VERSION = 5.0;'
        );
      }
      if (name === 'Debug') {
        if (/SWIFT_ACTIVE_COMPILATION_CONDITIONS = /.test(patched)) {
          patched = patched.replace(
            /SWIFT_ACTIVE_COMPILATION_CONDITIONS = ([^;]*);/,
            function (_, value) {
              if (/\bDEBUG\b/.test(value)) {
                return 'SWIFT_ACTIVE_COMPILATION_CONDITIONS = ' + value + ';';
              }
              const trimmed = String(value).replace(/^"/, '').replace(/"$/, '').trim();
              return 'SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG ' + trimmed + '";';
            }
          );
        } else {
          patched = patched.replace(
            /buildSettings = \{/,
            'buildSettings = {\n\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;'
          );
        }
      }
      return patched;
    }
  );
  return next;
}

function run(ctx) {
  const root = (ctx && ctx.opts && ctx.opts.projectRoot) || process.cwd();
  const file = findPbxproj(root);
  if (!file) return { patched: false };
  const src = fs.readFileSync(file, 'utf8');
  const next = patchPbxproj(src);
  if (next !== src) fs.writeFileSync(file, next);
  return { patched: next !== src, file: file };
}

module.exports = function (ctx) {
  run(ctx);
};
module.exports.findPbxproj = findPbxproj;
module.exports.patchPbxproj = patchPbxproj;
module.exports.run = run;
