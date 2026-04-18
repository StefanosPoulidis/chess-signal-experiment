'use strict';

// Stockfish wrapper. Fetches the asm.js build as a Blob so the Worker is
// same-origin, then exposes async `analyze(fen)` returning eval (white's POV)
// and best move (UCI).
// Requires no dependencies.

window.Engine = (() => {
  const STOCKFISH_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
  const DEFAULT_DEPTH = 15;

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
    send('isready');
    await withTimeout(
      waitFor(l => l.startsWith('readyok') ? true : false),
      10000, 'readyok'
    );
  }

  // Convert Stockfish cp (side-to-move POV) to white's POV using FEN.
  function toWhitePov(cp, fen) {
    const stm = fen.split(' ')[1]; // 'w' or 'b'
    return stm === 'b' ? -cp : cp;
  }

  // Returns { evalWhitePov, bestMoveUci, mate }.
  // mate: null or integer (signed from side-to-move POV, then flipped).
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
      send(`go depth ${depth}`);
    });

    const bestMoveUci = bestMoveLine.split(' ')[1];
    const lastInfo = infoLines[infoLines.length - 1] || '';
    const m = lastInfo.match(/score (cp|mate) (-?\d+)/);
    let evalWhitePov = null;
    let mate = null;
    if (m) {
      if (m[1] === 'cp') {
        evalWhitePov = toWhitePov(parseInt(m[2], 10) / 100, fen);
      } else {
        const mateInN = parseInt(m[2], 10);
        // Represent mate as large eval with correct sign.
        const stmSign = mateInN >= 0 ? 1 : -1;
        evalWhitePov = toWhitePov(stmSign * 100, fen);
        mate = toWhitePov(mateInN, fen) | 0; // flip sign same way
      }
    }
    return { evalWhitePov, bestMoveUci, mate };
  }

  return { init, analyze };
})();
