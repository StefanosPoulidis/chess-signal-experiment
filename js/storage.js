'use strict';

// Persistent experiment state and decision-clock accounting.

window.Store = (() => {
  const KEY = 'chess-signal-session';

  function load() {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function init(participant, puzzleOrder, config) {
    const c = config || {};
    const state = {
      schemaVersion: c.schemaVersion || 2,
      experimentVersion: c.experimentVersion || 'unknown',
      sessionId: participant.sessionId,
      participant,
      puzzleOrder,
      currentIdx: 0,
      startedAt: Date.now(),
      chessTaskEndedAt: null,
      surveySubmittedAt: null,
      taskStatus: 'in_progress',
      totalDecisionTimeMs: c.totalDecisionTimeMs || 6 * 60 * 1000,
      decisionTimeUsedMs: 0,
      activeDecisionStartedAt: null,
      activePuzzle: null,
      puzzles: [],
    };
    save(state);
    return state;
  }

  function remainingDecisionMs(state, now) {
    if (!state) return 0;
    const at = now === undefined ? Date.now() : now;
    const activeMs = state.activeDecisionStartedAt === null
      ? 0
      : Math.max(0, at - state.activeDecisionStartedAt);
    return Math.max(0, state.totalDecisionTimeMs - state.decisionTimeUsedMs - activeMs);
  }

  function beginDecisionTurn(now) {
    const at = now === undefined ? Date.now() : now;
    let result;
    const state = update(s => {
      const remaining = remainingDecisionMs(s, at);
      if (remaining <= 0) {
        result = { started: false, remainingMs: 0 };
        return;
      }
      if (s.activeDecisionStartedAt === null) {
        s.activeDecisionStartedAt = at;
        if (s.activePuzzle) s.activePuzzle.moveStartedRemainingMs = remaining;
      }
      result = {
        started: true,
        remainingMs: remainingDecisionMs(s, at),
        moveStartedRemainingMs: s.activePuzzle
          ? s.activePuzzle.moveStartedRemainingMs
          : remaining,
      };
    });
    return { ...result, state };
  }

  function pauseDecisionTurn(now) {
    const at = now === undefined ? Date.now() : now;
    let result = {
      elapsedMs: 0,
      moveStartedRemainingMs: null,
      remainingMs: 0,
      cumulativeDecisionTimeMs: 0,
    };
    const state = update(s => {
      if (s.activeDecisionStartedAt !== null) {
        const availableAtStart = Math.max(0, s.totalDecisionTimeMs - s.decisionTimeUsedMs);
        const elapsed = Math.min(
          availableAtStart,
          Math.max(0, at - s.activeDecisionStartedAt)
        );
        s.decisionTimeUsedMs = Math.min(
          s.totalDecisionTimeMs,
          s.decisionTimeUsedMs + elapsed
        );
        result.elapsedMs = elapsed;
        result.moveStartedRemainingMs = s.activePuzzle
          ? s.activePuzzle.moveStartedRemainingMs
          : availableAtStart;
        s.activeDecisionStartedAt = null;
      }
      result.remainingMs = remainingDecisionMs(s, at);
      result.cumulativeDecisionTimeMs = s.decisionTimeUsedMs;
    });
    return { ...result, state };
  }

  function update(fn) {
    const state = load();
    if (!state) throw new Error('No session');
    fn(state);
    save(state);
    return state;
  }

  // ---- downloads ----

  function toJson() {
    const state = load();
    return JSON.stringify(state, null, 2);
  }

  // CSV: one row per player move. All *_cp columns are centipawns from white's POV
  // (positive = white advantage). *_mate is mate distance in half-moves (signed
  // same way: positive = white delivers mate). Blank when engine had no score.
  function toCsv() {
    const state = load();
    if (!state) return '';
    const header = [
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
    const rows = [header];
    for (const p of state.puzzles) {
      for (const m of p.moves) {
        rows.push([
          state.participant.username,
          state.participant.condition,
          p.puzzleId,
          p.puzzleOrder,
          p.playerColor,
          p.startFen,
          p.startEvalCp ?? '',
          p.startEvalMate ?? '',
          p.startBestMoveSan || '',
          p.startBestMoveUci || '',
          p.startStockfishBestMoveUci || '',
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
        ]);
      }
    }
    return rows.map(r => r.map(csvCell).join(',')).join('\n');
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    const state = load();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `chess-signal_${state.participant.username}_${stamp}`;
    download(`${base}.json`, toJson(), 'application/json');
  }

  function downloadCsv() {
    const state = load();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `chess-signal_${state.participant.username}_${stamp}`;
    download(`${base}.csv`, toCsv(), 'text/csv');
  }

  return {
    init,
    load,
    save,
    update,
    clear,
    remainingDecisionMs,
    beginDecisionTurn,
    pauseDecisionTurn,
    downloadJson,
    downloadCsv,
    toJson,
    toCsv,
  };
})();
