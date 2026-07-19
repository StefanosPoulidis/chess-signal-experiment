'use strict';

// Idempotent sync to the Google Apps Script backing store. The server owns the
// canonical column order; the client sends named records only.

window.Sync = (() => {
  function cfg() { return window.CONFIG || {}; }

  async function post(payload) {
    const c = cfg();
    if (c.skipSync || !c.webAppUrl) {
      console.warn('[Sync] not configured; logged locally only', payload);
      return { ok: false, skipped: true, error: 'not configured' };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      c.syncTimeoutMs || 20000
    );
    try {
      const res = await fetch(c.webAppUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: c.secret, ...payload }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({ ok: false, error: 'non-JSON response' }));
      if (!json.ok) console.warn('[Sync] server returned not-ok', json);
      return json;
    } catch (err) {
      console.error('[Sync] POST failed', err);
      return { ok: false, error: String(err) };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function participantCp(cp, playerColor) {
    if (cp === null || cp === undefined || cp === '') return '';
    return playerColor === 'black' ? -cp : cp;
  }

  function iso(value) {
    return value ? new Date(value).toISOString() : '';
  }

  function moveRecords(state, puzzle) {
    return (puzzle.moves || []).map(move => ({
      username: state.participant.username,
      condition: state.participant.condition,
      puzzle_id: puzzle.puzzleId,
      puzzle_order: puzzle.puzzleOrder,
      player_color: puzzle.playerColor,
      start_fen: puzzle.startFen,
      start_eval_cp: puzzle.startEvalCp ?? '',
      start_eval_mate: puzzle.startEvalMate ?? '',
      start_best_move_san: puzzle.startBestMoveSan || '',
      start_best_move_uci: puzzle.startBestMoveUci || '',
      start_stockfish_best_move_uci: puzzle.startStockfishBestMoveUci || '',
      move_number: move.moveNumber,
      fen_before_move: move.fenBeforeMove,
      eval_before_move_cp: move.evalBeforeMoveCp ?? '',
      eval_before_move_mate: move.evalBeforeMoveMate ?? '',
      player_move_san: move.playerMove.san,
      player_move_uci: move.playerMove.uci,
      time_ms: move.timeMs,
      fen_after_move: move.fenAfterMove,
      eval_after_move_cp: move.evalAfterMoveCp ?? '',
      eval_after_move_mate: move.evalAfterMoveMate ?? '',
      stockfish_reply_san: move.stockfishReply ? move.stockfishReply.san : '',
      stockfish_reply_uci: move.stockfishReply ? move.stockfishReply.uci : '',
      fen_after_stockfish: move.fenAfterStockfish || '',
      eval_after_stockfish_cp: move.evalAfterStockfishCp ?? '',
      eval_after_stockfish_mate: move.evalAfterStockfishMate ?? '',
      move_id: `${state.sessionId}:p${puzzle.puzzleId}:m${move.moveNumber}`,
      session_id: state.sessionId,
      experiment_version: state.experimentVersion,
      schema_version: state.schemaVersion,
      puzzle_status: puzzle.status,
      puzzle_started_remaining_ms: puzzle.puzzleStartedRemainingMs,
      move_started_remaining_ms: move.moveStartedRemainingMs,
      move_ended_remaining_ms: move.moveEndedRemainingMs,
      cumulative_decision_time_ms: move.cumulativeDecisionTimeMs,
      eval_before_move_participant_cp: participantCp(move.evalBeforeMoveCp, puzzle.playerColor),
      eval_after_move_participant_cp: participantCp(move.evalAfterMoveCp, puzzle.playerColor),
      eval_after_stockfish_participant_cp: participantCp(move.evalAfterStockfishCp, puzzle.playerColor),
      terminal_outcome_after_player: move.terminalOutcomeAfterPlayer || '',
      terminal_outcome_after_stockfish: move.terminalOutcomeAfterStockfish || '',
    }));
  }

  function puzzleRecord(state, puzzle) {
    const firstMove = puzzle.moves && puzzle.moves[0];
    return {
      puzzle_record_id: `${state.sessionId}:p${puzzle.puzzleId}`,
      session_id: state.sessionId,
      username: state.participant.username,
      condition: state.participant.condition,
      experiment_version: state.experimentVersion,
      schema_version: state.schemaVersion,
      puzzle_id: puzzle.puzzleId,
      puzzle_order: puzzle.puzzleOrder,
      player_color: puzzle.playerColor,
      start_fen: puzzle.startFen,
      status: puzzle.status,
      end_reason: puzzle.endReason || '',
      started_at: iso(puzzle.startedAt),
      ended_at: iso(puzzle.endedAt),
      completed_before_timeout: puzzle.completedBeforeTimeout,
      moves_completed: (puzzle.moves || []).length,
      puzzle_started_remaining_ms: puzzle.puzzleStartedRemainingMs,
      puzzle_ended_remaining_ms: puzzle.puzzleEndedRemainingMs,
      start_eval_cp_white: puzzle.startEvalCp ?? '',
      start_eval_cp_participant: participantCp(puzzle.startEvalCp, puzzle.playerColor),
      start_eval_mate_white: puzzle.startEvalMate ?? '',
      start_best_move_san: puzzle.startBestMoveSan || '',
      start_best_move_uci: puzzle.startBestMoveUci || '',
      start_stockfish_best_move_uci: puzzle.startStockfishBestMoveUci || '',
      final_fen: puzzle.finalFen || '',
      final_eval_cp_white: puzzle.finalEvalCp ?? '',
      final_eval_cp_participant: participantCp(puzzle.finalEvalCp, puzzle.playerColor),
      final_eval_mate_white: puzzle.finalEvalMate ?? '',
      terminal_outcome: puzzle.terminalOutcome || '',
      first_move_san: firstMove ? firstMove.playerMove.san : '',
      first_move_uci: firstMove ? firstMove.playerMove.uci : '',
      followed_action_recommendation: state.participant.condition === 'act' && firstMove
        ? firstMove.playerMove.uci === puzzle.startBestMoveUci
        : '',
    };
  }

  function sessionRecord(state, surveyAnswers) {
    const answers = surveyAnswers || {};
    const completed = state.puzzles.filter(p => p.completedBeforeTimeout === true).length;
    const timedOut = state.puzzles.filter(p => p.completedBeforeTimeout === false).length;
    const outsideHelp = answers.q6 || '';
    return {
      username: state.participant.username,
      condition: state.participant.condition,
      session_id: state.sessionId,
      experiment_version: state.experimentVersion,
      schema_version: state.schemaVersion,
      started_at: iso(state.startedAt),
      chess_task_ended_at: iso(state.chessTaskEndedAt),
      survey_submitted_at: new Date().toISOString(),
      task_status: state.taskStatus,
      total_budget_ms: state.totalDecisionTimeMs,
      decision_time_used_ms: state.decisionTimeUsedMs,
      decision_time_remaining_ms: Math.max(0, state.totalDecisionTimeMs - state.decisionTimeUsedMs),
      puzzles_completed_before_timeout: completed,
      puzzles_timed_out_or_unstarted: timedOut,
      puzzle_order_played: (state.puzzleOrder || []).join('-'),
      survey_q1: answers.q1 || '',
      survey_q2: answers.q2 || '',
      survey_q3: answers.q3 || '',
      survey_q4: answers.q4 || '',
      survey_q5_removed: '',
      survey_q6_outside_help_used: outsideHelp,
      survey_q7_condition_specific: answers.q7 || '',
      data_quality_exclude: outsideHelp === 'yes',
      data_quality_reason: outsideHelp === 'yes' ? 'reported_outside_help' : '',
    };
  }

  function appendRecords(dataset, records) {
    if (!records.length) return Promise.resolve({ ok: true, appended: 0, skippedExisting: 0 });
    return post({ action: 'appendRecords', dataset, records });
  }

  async function pushPuzzleData(state, puzzle) {
    return pushPuzzlesData(state, [puzzle]);
  }

  async function pushPuzzlesData(state, puzzles) {
    const puzzleResult = await appendRecords(
      'puzzles',
      puzzles.map(puzzle => puzzleRecord(state, puzzle))
    );
    if (!puzzleResult.ok && !puzzleResult.skipped) return puzzleResult;
    const moves = puzzles.flatMap(puzzle => moveRecords(state, puzzle));
    return appendRecords('moves', moves);
  }

  async function flushSession(state, surveyAnswers) {
    const result = await pushPuzzlesData(state, state.puzzles);
    if (!result.ok && !result.skipped) return result;
    const sessionResult = await appendRecords('sessions', [sessionRecord(state, surveyAnswers)]);
    if (!sessionResult.ok || sessionResult.skipped) return sessionResult;
    if (sessionResult.verifiedPuzzleRecords !== 6 ||
        sessionResult.verifiedMoveRecords !== state.puzzles.reduce(
          (total, puzzle) => total + (puzzle.moves || []).length,
          0
        )) {
      return { ok: false, error: 'server could not verify the complete response set' };
    }
    return sessionResult;
  }

  function checkUsername(username) {
    return post({ action: 'checkUsername', username });
  }

  function claimUsername(username, condition, sessionId) {
    return post({ action: 'claimUsername', username, condition, sessionId });
  }

  return {
    checkUsername,
    claimUsername,
    pushPuzzleData,
    pushPuzzlesData,
    flushSession,
    _records: { moveRecords, puzzleRecord, sessionRecord },
  };
})();
