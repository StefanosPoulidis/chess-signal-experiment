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

  function toCsv() {
    const state = load();
    if (!state) return '';
    const rows = [
      ['username', 'condition', 'puzzle_id', 'player_color', 'puzzle_order',
       'start_fen', 'start_eval_white_pov', 'start_best_move_san',
       'move_number', 'player_move_san', 'player_move_uci',
       'fen_before_player', 'fen_after_player',
       'time_ms',
       'eval_before_player_white_pov', 'eval_after_player_white_pov',
       'stockfish_reply_san', 'stockfish_reply_uci',
       'fen_after_stockfish', 'eval_after_stockfish_white_pov'],
    ];
    for (const p of state.puzzles) {
      for (const m of p.moves) {
        rows.push([
          state.participant.username,
          state.participant.condition,
          p.id,
          p.playerColor,
          p.order,
          p.startFen,
          p.startEvalWhitePov,
          p.startBestMoveSan || '',
          m.moveNumber,
          m.playerMove.san,
          m.playerMove.uci,
          m.fenBeforePlayer,
          m.fenAfterPlayer,
          m.timeMs,
          m.evalBeforePlayerWhitePov,
          m.evalAfterPlayerWhitePov,
          m.stockfishReply ? m.stockfishReply.san : '',
          m.stockfishReply ? m.stockfishReply.uci : '',
          m.fenAfterStockfish || '',
          m.evalAfterStockfishWhitePov ?? '',
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
