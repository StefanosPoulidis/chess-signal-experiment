'use strict';

// Stockfish wrapper. The pinned, self-hosted WebAssembly build runs in a
// same-origin Worker and returns evaluations from White's point of view.

window.Engine = (() => {
  const STOCKFISH_SCRIPT = 'vendor/stockfish-18/stockfish-18-lite-single.js';
  const STOCKFISH_WASM = 'stockfish-18-lite-single.wasm';
  const SEARCH_DEPTH = 20;
  const HARD_TIMEOUT_MS = 30000;
  const PINNED_METADATA = {
    name: 'Stockfish',
    version: '18',
    packageVersion: '18.0.8',
    build: 'lite-single-wasm',
    searchMode: 'depth',
    searchValue: SEARCH_DEPTH,
  };

  let worker = null;
  let listeners = [];
  let reportedName = '';

  function onMessage(e) {
    const line = typeof e.data === 'string' ? e.data : '';
    if (line.startsWith('id name ')) reportedName = line.slice('id name '.length).trim();
    listeners = listeners.filter(l => {
      const result = l.matcher(line);
      if (result !== false && result !== undefined) {
        l.resolve(result);
        return false;
      }
      return true;
    });
  }

  function onError(error) {
    const pending = listeners;
    listeners = [];
    pending.forEach(listener => listener.reject(error));
  }

  function waitFor(matcher) {
    return new Promise((resolve, reject) => {
      listeners.push({ matcher, resolve, reject });
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
    const workerUrl = new URL(STOCKFISH_SCRIPT, window.location.href);
    // The first hash item tells stockfish.js where its WASM lives. The
    // `,worker` suffix is reserved for nested pthread workers and would make
    // this single-threaded top-level Worker exit without initializing.
    workerUrl.hash = STOCKFISH_WASM;
    worker = new Worker(workerUrl.toString());
    worker.onmessage = onMessage;
    worker.onerror = onError;
    send('uci');
    await withTimeout(
      waitFor(l => l.startsWith('uciok') ? true : false),
      10000, 'uciok'
    );
    // No UCI_LimitStrength: use the pinned engine at the paper's depth 20.
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
    const analysisPromise = new Promise((resolve, reject) => {
      listenerRef = {
        matcher: (line) => {
          if (line.startsWith('info ') && /score (cp|mate) /.test(line)) {
            infoLines.push(line);
          }
          if (line.startsWith('bestmove ')) return line;
          return false;
        },
        resolve,
        reject,
      };
      listeners.push(listenerRef);
      send(`go depth ${SEARCH_DEPTH}`);
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

  function metadata() {
    return { ...PINNED_METADATA, reportedName: reportedName || 'Stockfish 18' };
  }

  return { init, analyze, metadata };
})();
