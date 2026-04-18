'use strict';

// Session state + per-move logging + JSON/CSV download.
// All data lives in localStorage (key: "session") so a refresh doesn't lose work,
// plus sessionStorage holds a pointer to the active participant.

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

  function init(participant, puzzleOrder) {
    const state = {
      participant,          // { username, condition }
      puzzleOrder,          // array of puzzle ids in play order
      currentIdx: 0,        // index into puzzleOrder
      startedAt: Date.now(),
      puzzles: [],          // per-puzzle records, appended as they complete
    };
    save(state);
    return state;
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
      'start_best_move_san', 'start_best_move_uci',
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

  return { init, load, save, update, clear, downloadJson, downloadCsv, toJson, toCsv };
})();
