#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const context = { window: { CONFIG: { skipSync: true } }, console, Date, Promise, Math };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'scoring.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8'), context);

const state = {
  schemaVersion: 3,
  experimentVersion: 'test-v3',
  sessionId: 'session-1',
  participant: { username: 'test-user-001', condition: 'act' },
  startedAt: 1000,
  chessTaskEndedAt: 361000,
  taskStatus: 'completed_with_timeouts',
  puzzleDecisionTimeMs: 75000,
  totalDecisionTimeMs: 450000,
  decisionTimeUsedMs: 75000,
  puzzleOrder: [4, 1, 2, 3, 5, 6],
  engineMetadata: {
    name: 'Stockfish',
    reportedName: 'Stockfish 18',
    version: '18',
    packageVersion: '18.0.8',
    build: 'lite-single-wasm',
    searchMode: 'depth',
    searchValue: 20,
  },
  scoringMetadata: context.window.Scoring.metadata(),
  puzzles: [],
};
const puzzle = {
  puzzleId: 4,
  puzzleOrder: 1,
  playerColor: 'black',
  startFen: 'test fen',
  status: 'timed_out',
  endReason: 'puzzle_time_limit_expired',
  completedBeforeTimeout: false,
  puzzleStartedRemainingMs: 75000,
  puzzleEndedRemainingMs: 0,
  startEvalCp: 200,
  startEvalMate: null,
  startBestMoveSan: 'Rxh4',
  startBestMoveUci: 'c4h4',
  startStockfishBestMoveUci: 'c4h4',
  finalFen: 'final fen',
  finalEvalCp: 350,
  finalEvalMate: null,
  moves: [{
    moveNumber: 1,
    fenBeforeMove: 'before',
    evalBeforeMoveCp: 200,
    evalBeforeMoveMate: null,
    playerMove: { san: 'Rxh4', uci: 'c4h4' },
    timeMs: 1200,
    moveStartedRemainingMs: 75000,
    moveEndedRemainingMs: 73800,
    cumulativeDecisionTimeMs: 1200,
    fenAfterMove: 'after',
    evalAfterMoveCp: 350,
    evalAfterMoveMate: null,
    stockfishReply: null,
    fenAfterStockfish: null,
    evalAfterStockfishCp: null,
    evalAfterStockfishMate: null,
  }],
};
state.puzzles = [puzzle];

const records = context.window.Sync._records;
const move = records.moveRecords(state, puzzle)[0];
const puzzleRow = records.puzzleRecord(state, puzzle);
if (move.eval_before_move_participant_cp !== -200) throw new Error('black evaluation must be participant-relative');
if (move.eval_after_move_participant_cp !== -350) throw new Error('black post-move evaluation must be participant-relative');
if (!move.move_id || !move.session_id) throw new Error('move idempotency keys are missing');
if (move.win_percentage_before_move_participant !== 32.378836) {
  throw new Error('pre-move win percentage does not match the paper formula');
}
if (move.win_probability_before_move_participant !== 0.323788) {
  throw new Error('pre-move win probability must be win percentage divided by 100');
}
if (!move.move_accuracy_valid || move.move_accuracy === '') {
  throw new Error('valid paper-defined move accuracy must be retained');
}
if (move.evaluation_engine_version !== '18' || move.evaluation_search_depth !== 20) {
  throw new Error('evaluation engine metadata must accompany move measurements');
}

const scoring = context.window.Scoring;
if (scoring.winPercentageFromCp(0) !== 50) throw new Error('CP zero must map to 50 percent');
const blackMate = scoring.positionMetrics(10000, 'black', 'black_checkmated');
if (blackMate.whiteWinProbability !== 1 || blackMate.participantWinProbability !== 0) {
  throw new Error('terminal win probabilities must be exact and participant-relative');
}
const improved = scoring.moveAccuracy(50, 60);
if (improved.valid || improved.invalidReason !== 'out_of_range' || improved.raw <= 100) {
  throw new Error('paper-invalid accuracy values must be flagged, not clipped');
}

const session = records.sessionRecord(state, { q1: 'agree', q6: 'yes', q7: 'agree' });
if (session.survey_q6_outside_help_used !== 'yes') throw new Error('outside-help answer mapped incorrectly');
if (session.data_quality_exclude !== true) throw new Error('outside-help Yes must be exclusion-flagged');
if (session.survey_q7_condition_specific !== 'agree') throw new Error('condition-specific Q7 mapped incorrectly');
if (session.survey_q5_removed !== '') throw new Error('removed Q5 column must stay blank');
if (session.scoring_method_version !== 'action-attention-paper-appendix-c2-v1') {
  throw new Error('session must version the paper scoring method');
}

const appsContext = {};
vm.createContext(appsContext);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.js'), 'utf8') +
    '\nthis.TEST_SCHEMAS = DATASET_SCHEMAS;',
  appsContext
);
for (const [dataset, record] of Object.entries({ sessions: session, puzzles: puzzleRow, moves: move })) {
  const missing = appsContext.TEST_SCHEMAS[dataset].headers.filter(header => !(header in record));
  if (missing.length) throw new Error(`${dataset} record missing schema fields: ${missing.join(', ')}`);
}

const syncSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'engine.js'), 'utf8');
const timeoutSource = gameSource.slice(
  gameSource.indexOf('async function expirePuzzleTime'),
  gameSource.indexOf('function finishCompletedSession')
);
if (!syncSource.includes('function pushPuzzlesData')) throw new Error('puzzle sync must support batching');
if (!gameSource.includes('This session was started under an earlier study version.')) {
  throw new Error('protocol-version changes must not silently overwrite an in-progress session');
}
if (!timeoutSource.includes('Sync.pushPuzzleData')) throw new Error('timed-out puzzle must be synced');
if (!timeoutSource.includes('state.currentIdx += 1')) throw new Error('timeout must advance by exactly one puzzle');
if (timeoutSource.includes('state.currentIdx = state.puzzleOrder.length')) throw new Error('one timeout must not end the chess task');
if (timeoutSource.includes('not_started_timeout')) throw new Error('later puzzles must remain available after a timeout');
if (timeoutSource.includes('await analyzePosition')) throw new Error('timeout finalization must not run a new engine search');
if (!engineSource.includes("waitFor(l => l.startsWith('bestmove ') ? l : false)")) {
  throw new Error('engine timeout must retain the best move found before stop');
}
if (!engineSource.includes('stockfish-18-lite-single.js') || !engineSource.includes('go depth ${SEARCH_DEPTH}')) {
  throw new Error('live engine must use the pinned Stockfish 18 depth-20 build');
}
if (engineSource.includes('cdn.jsdelivr.net/npm/stockfish.js@10.0.2')) {
  throw new Error('legacy Stockfish 10 CDN dependency must be removed');
}

const engineHashes = {
  'stockfish-18-lite-single.js': '5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391',
  'stockfish-18-lite-single.wasm': 'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1',
};
for (const [filename, expected] of Object.entries(engineHashes)) {
  const bytes = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'stockfish-18', filename));
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`pinned engine asset checksum mismatch: ${filename}`);
}

console.log('data schema and scoring contract ok');
