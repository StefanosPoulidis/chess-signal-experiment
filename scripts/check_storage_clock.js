#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const values = new Map();
const context = {
  window: {},
  localStorage: {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  },
  document: {},
  Blob,
  URL,
  Date,
  JSON,
  console,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8'), context);

const Store = context.window.Store;
const participant = { username: 'test-user-001', condition: 'att', sessionId: 'session-1' };
let state = Store.init(participant, [1, 2, 3, 4, 5, 6], {
  schemaVersion: 2,
  experimentVersion: 'test-v2',
  totalDecisionTimeMs: 360000,
});

if (Store.remainingDecisionMs(state, 1000) !== 360000) throw new Error('fresh budget must be six minutes');
Store.update(current => { current.activePuzzle = { puzzleId: 1, moveStartedRemainingMs: null }; });
let timing = Store.beginDecisionTurn(1000);
if (!timing.started || timing.remainingMs !== 360000) throw new Error('decision turn did not start');
if (Store.remainingDecisionMs(timing.state, 2500) !== 358500) throw new Error('active clock did not count elapsed time');

timing = Store.pauseDecisionTurn(4000);
if (timing.elapsedMs !== 3000) throw new Error('move duration was not recorded');
if (timing.remainingMs !== 357000) throw new Error('clock did not pause with correct balance');
if (timing.moveStartedRemainingMs !== 360000) throw new Error('move-start balance was not preserved');

Store.beginDecisionTurn(5000);
timing = Store.pauseDecisionTurn(500000);
if (timing.elapsedMs !== 357000) throw new Error('elapsed time must be capped at remaining budget');
if (timing.remainingMs !== 0) throw new Error('expired budget must be zero');
if (timing.cumulativeDecisionTimeMs !== 360000) throw new Error('cumulative time must be capped at six minutes');

console.log('persistent decision clock contract ok');
