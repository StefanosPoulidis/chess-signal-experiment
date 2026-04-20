'use strict';

// Background sync to a Google Apps Script Web App (backing a Google Sheet).
// Uses text/plain content-type to avoid CORS preflight. All calls are
// fire-and-forget from the caller's POV; failures are logged + returned
// as { ok: false } so callers can decide how loud to be.

window.Sync = (() => {
  const MOVES_HEADER = [
    'username', 'condition',
    'puzzle_id', 'puzzle_order', 'player_color',
    'start_fen', 'start_eval_cp', 'start_eval_mate',
    'start_best_move_san', 'start_best_move_uci', 'start_stockfish_best_move_uci',
    'move_number',
    'fen_before_move', 'eval_before_move_cp', 'eval_before_move_mate',
    'player_move_san', 'player_move_uci', 'time_ms',
    'fen_after_move', 'eval_after_move_cp', 'eval_after_move_mate',
    'stockfish_reply_san', 'stockfish_reply_uci',
    'fen_after_stockfish', 'eval_after_stockfish_cp', 'eval_after_stockfish_mate',
  ];

  // Sessions header is dynamic: base columns plus one column per survey question key.
  const SESSION_BASE_HEADER = [
    'username', 'condition',
    'started_at', 'puzzles_completed_at', 'survey_submitted_at',
    'puzzle_order_played',
  ];

  function cfg() { return window.CONFIG || {}; }

  async function post(payload) {
    const c = cfg();
    if (c.skipSync || !c.webAppUrl) {
      console.warn('[Sync] not configured; logged locally only', payload);
      return { ok: false, skipped: true, error: 'not configured' };
    }
    try {
      const res = await fetch(c.webAppUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: c.secret, ...payload }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: 'non-JSON response' }));
      if (!json.ok) console.warn('[Sync] server returned not-ok', json);
      return json;
    } catch (err) {
      console.error('[Sync] POST failed', err);
      return { ok: false, error: String(err) };
    }
  }

  async function pushMoves(state, puzzleRecord) {
    const rows = puzzleRecord.moves.map(m => ([
      state.participant.username,
      state.participant.condition,
      puzzleRecord.puzzleId,
      puzzleRecord.puzzleOrder,
      puzzleRecord.playerColor,
      puzzleRecord.startFen,
      puzzleRecord.startEvalCp ?? '',
      puzzleRecord.startEvalMate ?? '',
      puzzleRecord.startBestMoveSan || '',
      puzzleRecord.startBestMoveUci || '',
      puzzleRecord.startStockfishBestMoveUci || '',
      m.moveNumber,
      m.fenBeforeMove,
      m.evalBeforeMoveCp ?? '',
      m.evalBeforeMoveMate ?? '',
      m.playerMove.san,
      m.playerMove.uci,
      m.timeMs,
      m.fenAfterMove,
      m.evalAfterMoveCp ?? '',
      m.evalAfterMoveMate ?? '',
      m.stockfishReply ? m.stockfishReply.san : '',
      m.stockfishReply ? m.stockfishReply.uci : '',
      m.fenAfterStockfish || '',
      m.evalAfterStockfishCp ?? '',
      m.evalAfterStockfishMate ?? '',
    ]));
    return post({ tab: 'moves', headers: MOVES_HEADER, rows });
  }

  async function pushSession(state, surveyAnswers, puzzlesCompletedAt) {
    const surveyKeys = Object.keys(surveyAnswers || {}).sort();
    const headers = [...SESSION_BASE_HEADER, ...surveyKeys.map(k => 'survey_' + k)];
    const row = [
      state.participant.username,
      state.participant.condition,
      state.startedAt ? new Date(state.startedAt).toISOString() : '',
      puzzlesCompletedAt ? new Date(puzzlesCompletedAt).toISOString() : '',
      new Date().toISOString(),
      (state.puzzleOrder || []).join('-'),
      ...surveyKeys.map(k => surveyAnswers[k] ?? ''),
    ];
    return post({ tab: 'sessions', headers, rows: [row] });
  }

  return { pushMoves, pushSession };
})();
