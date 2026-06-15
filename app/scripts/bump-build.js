#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const appDir = path.join(__dirname, '..');
const metaPath = path.join(appDir, 'build-meta.json');
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
meta.version = pkg.version;
meta.build += 1;
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
console.log(`Build number bumped → ${meta.version} build ${meta.build}`);
