#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

function makePuzzle(id) {
  return {
    puzzleId: id,
    puzzleOrder: id,
    playerColor: id <= 4 ? 'white' : 'black',
    startFen: `test-fen-${id}`,
    status: 'not_started_timeout',
    endReason: 'test_timeout',
    startedAt: null,
    endedAt: Date.now(),
    completedBeforeTimeout: false,
    puzzleStartedRemainingMs: 0,
    puzzleEndedRemainingMs: 0,
    startEvalCp: null,
    startEvalMate: null,
    startBestMoveSan: '',
    startBestMoveUci: '',
    startStockfishBestMoveUci: '',
    finalFen: `test-fen-${id}`,
    finalEvalCp: null,
    finalEvalMate: null,
    terminalOutcome: '',
    moves: [],
  };
}

const state = {
  participant: { username: 'test-user', condition: 'att' },
  sessionId: 'session-1',
  experimentVersion: 'test-version',
  schemaVersion: 2,
  startedAt: Date.now(),
  chessTaskEndedAt: Date.now(),
  taskStatus: 'timed_out',
  totalDecisionTimeMs: 360000,
  decisionTimeUsedMs: 360000,
  puzzleOrder: [1, 2, 3, 4, 5, 6],
  puzzles: [1, 2, 3, 4, 5, 6].map(makePuzzle),
};

function loadSync(responseForPayload) {
  const requests = [];
  const sandbox = {
    window: {
      CONFIG: {
        webAppUrl: 'https://example.invalid/exec',
        secret: 'test-secret',
        syncTimeoutMs: 1000,
      },
    },
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (_url, options) => {
      const payload = JSON.parse(options.body);
      requests.push(payload);
      const response = await responseForPayload(payload);
      return { json: async () => response };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/sync.js', 'utf8'), sandbox);
  return { Sync: sandbox.window.Sync, requests };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const successful = loadSync(async payload => {
    if (payload.dataset === 'sessions') {
      return { ok: true, verifiedPuzzleRecords: 6, verifiedMoveRecords: 0 };
    }
    return { ok: true, appended: payload.records.length, skippedExisting: 0 };
  });
  const successResult = await successful.Sync.flushSession(state, { q6: 'no' });
  assert(successResult.ok, 'a complete server receipt must finish submission');
  assert(successful.requests.length === 2, 'zero-move timeout session should write puzzles and session');

  const missingReceipt = loadSync(async payload => {
    if (payload.dataset === 'sessions') return { ok: true, appended: 1, skippedExisting: 0 };
    return { ok: true, appended: payload.records.length, skippedExisting: 0 };
  });
  const missingReceiptResult = await missingReceipt.Sync.flushSession(state, { q6: 'no' });
  assert(!missingReceiptResult.ok, 'browser must not finish without a verified completion receipt');

  const interrupted = loadSync(async payload => {
    if (payload.dataset === 'puzzles') throw new Error('simulated network interruption');
    return { ok: true, verifiedPuzzleRecords: 6, verifiedMoveRecords: 0 };
  });
  const interruptedResult = await interrupted.Sync.flushSession(state, { q6: 'no' });
  assert(!interruptedResult.ok, 'network interruption must leave submission retryable');
  assert(interrupted.requests.length === 1, 'session must not be submitted after a failed puzzle write');

  console.log('client sync interruption and completion-receipt contract ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
