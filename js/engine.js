'use strict';

// Stockfish wrapper. Fetches the asm.js build as a Blob so the Worker is
// same-origin, then exposes async `analyze(fen)` returning eval (white's POV)
// and best move (UCI).
// Requires no dependencies.

window.Engine = (() => {
  const STOCKFISH_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
  // A fixed node budget gives every participant the same engine effort even
  // when their device runs Stockfish at a different speed.
  const SEARCH_NODES = 250000;
  const HARD_TIMEOUT_MS = 20000;

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
    // No UCI_LimitStrength - run Stockfish at full strength. The fixed node
    // budget below standardizes search effort across participant devices.
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
  async function analyze(fen) {
    if (!worker) throw new Error('Engine not initialized');
    send('ucinewgame');
    send(`position fen ${fen}`);

    const infoLines = [];
    let listenerRef;
    const analysisPromise = new Promise(resolve => {
      listenerRef = {
        matcher: (line) => {
          if (line.startsWith('info ') && /score (cp|mate) /.test(line)) {
            infoLines.push(line);
          }
          if (line.startsWith('bestmove ')) return line;
          return false;
        },
        resolve,
      };
      listeners.push(listenerRef);
      send(`go nodes ${SEARCH_NODES}`);
    });

    // Hard ceiling: stop a slow search and use the best move found so far.
    // This prevents a slow device from freezing the whole platform.
    const bestMoveLine = await Promise.race([
      analysisPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('analyze timeout')), HARD_TIMEOUT_MS)
      ),
    ]).catch(async err => {
      console.warn('[Engine] analyze timed out — detaching listener', err);
      const idx = listeners.indexOf(listenerRef);
      if (idx >= 0) listeners.splice(idx, 1);
      send('stop');
      // `stop` triggers Stockfish to emit the current search's bestmove.
      // Capture it here so it cannot leak into the next analyze call.
      try {
        return await withTimeout(
          waitFor(l => l.startsWith('bestmove ') ? l : false),
          2000, 'drain bestmove'
        );
      } catch { /* ignore */ }
      return 'bestmove (none)';
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
