#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { window: { CONFIG: { skipSync: true } }, console, Date, Promise };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8'), context);

const state = {
  schemaVersion: 2,
  experimentVersion: 'test-v2',
  sessionId: 'session-1',
  participant: { username: 'test-user-001', condition: 'act' },
  startedAt: 1000,
  chessTaskEndedAt: 361000,
  taskStatus: 'timed_out',
  totalDecisionTimeMs: 360000,
  decisionTimeUsedMs: 360000,
  puzzleOrder: [4, 1, 2, 3, 5, 6],
  puzzles: [],
};
const puzzle = {
  puzzleId: 4,
  puzzleOrder: 1,
  playerColor: 'black',
  startFen: 'test fen',
  status: 'timed_out',
  endReason: 'total_time_budget_expired',
  completedBeforeTimeout: false,
  puzzleStartedRemainingMs: 360000,
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
    moveStartedRemainingMs: 360000,
    moveEndedRemainingMs: 358800,
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
if (move.eval_before_move_participant_cp !== -200) throw new Error('black evaluation must be participant-relative');
if (move.eval_after_move_participant_cp !== -350) throw new Error('black post-move evaluation must be participant-relative');
if (!move.move_id || !move.session_id) throw new Error('move idempotency keys are missing');

const session = records.sessionRecord(state, { q1: 'agree', q6: 'yes', q7: 'agree' });
if (session.survey_q6_outside_help_used !== 'yes') throw new Error('outside-help answer mapped incorrectly');
if (session.data_quality_exclude !== true) throw new Error('outside-help Yes must be exclusion-flagged');
if (session.survey_q7_condition_specific !== 'agree') throw new Error('condition-specific Q7 mapped incorrectly');
if (session.survey_q5_removed !== '') throw new Error('removed Q5 column must stay blank');

const syncSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'engine.js'), 'utf8');
const timeoutSource = gameSource.slice(
  gameSource.indexOf('async function expireTimeBudget'),
  gameSource.indexOf('function finishCompletedSession')
);
if (!syncSource.includes('function pushPuzzlesData')) throw new Error('puzzle sync must support batching');
if (!timeoutSource.includes('Sync.pushPuzzlesData')) throw new Error('timeout records must be synced before the survey');
if (timeoutSource.includes('await analyzePosition')) throw new Error('timeout finalization must not run six new engine searches');
if (!engineSource.includes("waitFor(l => l.startsWith('bestmove ') ? l : false)")) {
  throw new Error('engine timeout must retain the best move found before stop');
}

console.log('data schema and scoring contract ok');
