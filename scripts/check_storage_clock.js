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
  schemaVersion: 3,
  experimentVersion: 'test-v3',
  puzzleDecisionTimeMs: 75000,
});

if (state.totalDecisionTimeMs !== 450000) throw new Error('nominal total must sum six independent limits');
if (Store.remainingDecisionMs(state, 1000) !== 75000) throw new Error('fresh puzzle must have 75 seconds');
Store.update(current => {
  current.activePuzzle = { puzzleId: 1, decisionTimeUsedMs: 0, moveStartedRemainingMs: null };
});
let timing = Store.beginDecisionTurn(1000);
if (!timing.started || timing.remainingMs !== 75000) throw new Error('decision turn did not start');
if (Store.remainingDecisionMs(timing.state, 2500) !== 73500) throw new Error('active clock did not count elapsed time');

timing = Store.pauseDecisionTurn(4000);
if (timing.elapsedMs !== 3000) throw new Error('move duration was not recorded');
if (timing.remainingMs !== 72000) throw new Error('clock did not pause with correct balance');
if (timing.moveStartedRemainingMs !== 75000) throw new Error('move-start balance was not preserved');

Store.beginDecisionTurn(5000);
timing = Store.pauseDecisionTurn(500000);
if (timing.elapsedMs !== 72000) throw new Error('elapsed time must be capped at remaining puzzle limit');
if (timing.remainingMs !== 0) throw new Error('expired budget must be zero');
if (timing.cumulativeDecisionTimeMs !== 75000) throw new Error('puzzle time must be capped at 75 seconds');

Store.update(current => {
  current.activeDecisionStartedAt = null;
  current.activePuzzle = { puzzleId: 2, decisionTimeUsedMs: 0, moveStartedRemainingMs: null };
});
timing = Store.beginDecisionTurn(600000);
if (!timing.started || timing.remainingMs !== 75000) throw new Error('unused time must not carry between puzzles');
timing = Store.pauseDecisionTurn(601000);
if (timing.elapsedMs !== 1000 || timing.remainingMs !== 74000) throw new Error('second puzzle clock is not independent');
if (timing.cumulativeDecisionTimeMs !== 76000) throw new Error('session cumulative decision time is incorrect');
if (timing.state.decisionTimeUsedMs !== 76000) throw new Error('session aggregate decision time is incorrect');

console.log('independent persistent puzzle-clock contract ok');
