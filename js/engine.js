'use strict';

// Stockfish wrapper. Fetches the asm.js build as a Blob so the Worker is
// same-origin, then exposes async `analyze(fen)` returning eval (white's POV)
// and best move (UCI).
// Requires no dependencies.

window.Engine = (() => {
  const STOCKFISH_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
  const DEFAULT_DEPTH = 18;           // upper bound on search depth
  const MAX_SEARCH_MS = 1200;         // hard cap: stop the search after 1.2s regardless of depth

  let worker = null;
  let listeners = [];

  function onMessage(e) {
    const line = typeof e.data === 'string' ? e.data : '';
    listeners = listeners.filter(l => {
      const result = l.matcher(line);
      if (result !== false && result !== undefined) {
        l.resolve(result);
        return false;
      }
      return true;
    });
  }

  function waitFor(matcher) {
    return new Promise(resolve => {
      listeners.push({ matcher, resolve });
    });
  }

  function send(cmd) {
    worker.postMessage(cmd);
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Engine timeout: ${label}`)), ms)
      ),
    ]);
  }

  async function init() {
    if (worker) return;
    const res = await withTimeout(fetch(STOCKFISH_URL), 15000, 'fetch stockfish');
    if (!res.ok) throw new Error(`Stockfish fetch failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    worker = new Worker(blobUrl);
    worker.onmessage = onMessage;
    send('uci');
    await withTimeout(
      waitFor(l => l.startsWith('uciok') ? true : false),
      10000, 'uciok'
    );
    // No UCI_LimitStrength — run Stockfish at full strength. Deterministic
    // per position given the same depth.
    send('isready');
    await withTimeout(
      waitFor(l => l.startsWith('readyok') ? true : false),
      10000, 'readyok'
    );
  }

  // Returns { cp, mate, bestMoveUci }, all in WHITE'S POV.
  //   cp:   integer centipawns (Stockfish's native unit). Positive = white advantage.
  //         For mate scores, cp is set to ±10000 as a conventional sentinel.
  //   mate: null for normal scores. For mate scores, signed half-move distance;
  //         positive = white delivers mate, negative = black delivers mate.
  //   bestMoveUci: Stockfish's best move in UCI format, or "(none)" if no moves.
  async function analyze(fen, depth = DEFAULT_DEPTH) {
    if (!worker) throw new Error('Engine not initialized');
    send('ucinewgame');
    send(`position fen ${fen}`);

    const infoLines = [];
    const bestMoveLine = await new Promise(resolve => {
      listeners.push({
        matcher: (line) => {
          if (line.startsWith('info ') && /score (cp|mate) /.test(line)) {
            infoLines.push(line);
          }
          if (line.startsWith('bestmove ')) return line;
          return false;
        },
        resolve,
      });
      // Search stops at whichever arrives first: `depth` plies or `movetime` ms.
      send(`go depth ${depth} movetime ${MAX_SEARCH_MS}`);
    });

    const bestMoveUci = bestMoveLine.split(' ')[1];
    const lastInfo = infoLines[infoLines.length - 1] || '';
    const m = lastInfo.match(/score (cp|mate) (-?\d+)/);

    // Stockfish cp / mate are from side-to-move's POV. Flip to white's POV.
    const stm = fen.split(' ')[1];
    const flip = (x) => stm === 'b' ? -x : x;

    let cp = null;
    let mate = null;
    if (m) {
      if (m[1] === 'cp') {
        cp = flip(parseInt(m[2], 10));
      } else {
        mate = flip(parseInt(m[2], 10));
        cp = mate > 0 ? 10000 : (mate < 0 ? -10000 : 0);
      }
    }
    return { cp, mate, bestMoveUci };
  }

  return { init, analyze };
})();
