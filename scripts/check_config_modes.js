#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');

function loadConfig(hostname, search) {
  const context = {
    window: { location: { hostname, search } },
    URLSearchParams,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.CONFIG;
}

const production = loadConfig('stefanospoulidis.github.io', '?smoke=timeout');
if (production.skipSync) throw new Error('production must never disable sync from a query parameter');
if (production.totalDecisionTimeMs !== 360000) throw new Error('production budget must remain six minutes');
if (production.syncTimeoutMs !== 20000) throw new Error('production sync must have a bounded timeout');

const timeout = loadConfig('127.0.0.1', '?smoke=timeout');
if (!timeout.skipSync || timeout.totalDecisionTimeMs !== 8000) {
  throw new Error('local timeout smoke mode is misconfigured');
}

const move = loadConfig('localhost', '?smoke=move');
if (!move.skipSync || move.totalDecisionTimeMs !== 360000) {
  throw new Error('local move smoke mode is misconfigured');
}

console.log('configuration mode contract ok');
