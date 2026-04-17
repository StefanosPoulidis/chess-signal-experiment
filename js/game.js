'use strict';

// Game flow controller.
// Orchestrates puzzle sequence, move timing, Stockfish calls, and logging.
// Requires: chess.js (Chess global), Engine, Board, Store, PUZZLES, MOVES_PER_PUZZLE.

window.Game = (() => {
  const els = {};
  let session = null;     // Store state
  let puzzle = null;      // current puzzle spec
  let chess = null;       // chess.js instance
  let moveIdx = 0;        // 0..MOVES_PER_PUZZLE - 1 (next player move)
  let moveStartTs = 0;    // ms
  let evalBeforePlayer = null;
  let puzzleRecord = null;

  // ---------- lifecycle ----------

  async function start() {
    cacheEls();
    const pStr = sessionStorage.getItem('participant');
    if (!pStr) {
      window.location.href = 'index.html';
      return;
    }
    const participant = JSON.parse(pStr);

    // Fresh or resumed session?
    session = Store.load();
    if (!session || session.participant.username !== participant.username) {
      const order = shuffle(PUZZLES.map(p => p.id));
      session = Store.init(participant, order);
    }

    setStatus('Loading engine…');
    await Engine.init();

    await loadNextPuzzle();
  }

  function cacheEls() {
    ['status', 'puzzle-indicator', 'condition-badge', 'banner', 'timer',
     'eval-display', 'next-button', 'download-json', 'download-csv', 'finished-ui', 'experiment-ui']
      .forEach(id => { els[id] = document.getElementById(id); });
  }

  function setStatus(text) {
    if (els['status']) els['status'].textContent = text;
  }

  // ---------- puzzle flow ----------

  async function loadNextPuzzle() {
    if (session.currentIdx >= session.puzzleOrder.length) {
      finishSession();
      return;
    }
    const pid = session.puzzleOrder[session.currentIdx];
    puzzle = PUZZLES.find(p => p.id === pid);
    chess = new Chess(puzzle.startFen);
    moveIdx = 0;
    evalBeforePlayer = null;

    els['condition-badge'].textContent = session.participant.condition.toUpperCase();
    els['condition-badge'].className = 'badge ' + session.participant.condition;
    els['puzzle-indicator'].textContent =
      `Puzzle ${session.currentIdx + 1} of ${session.puzzleOrder.length}`;

    // Initial board
    Board.destroy();
    Board.create({
      elementId: 'chess-board',
      fen: puzzle.startFen,
      playerColor: puzzle.playerColor,
      onDrop: handleDrop,
    });
    // Small delay so DOM measures correctly
    await new Promise(r => setTimeout(r, 30));
    Board.resize();

    setStatus('Analyzing starting position…');
    const { evalWhitePov, bestMoveUci } = await Engine.analyze(puzzle.startFen);
    evalBeforePlayer = evalWhitePov;

    // Convert bestMoveUci to SAN
    const testChess = new Chess(puzzle.startFen);
    const moveObj = testChess.move({
      from: bestMoveUci.slice(0, 2),
      to: bestMoveUci.slice(2, 4),
      promotion: bestMoveUci.length === 5 ? bestMoveUci[4] : undefined,
    });
    const bestMoveSan = moveObj ? moveObj.san : bestMoveUci;

    puzzleRecord = {
      id: puzzle.id,
      playerColor: puzzle.playerColor,
      order: session.currentIdx + 1,
      startFen: puzzle.startFen,
      startEvalWhitePov: evalWhitePov,
      startBestMoveUci: bestMoveUci,
      startBestMoveSan: bestMoveSan,
      moves: [],
    };

    showSignal(bestMoveUci, bestMoveSan);
    setStatus('Your move.');
    moveStartTs = performance.now();
  }

  function showSignal(bestMoveUci, bestMoveSan) {
    const cond = session.participant.condition;
    const banner = els['banner'];
    banner.classList.remove('hidden', 'att', 'act');
    if (cond === 'att') {
      banner.classList.add('att');
      banner.textContent = 'There is a unique optimal move here!';
    } else if (cond === 'act') {
      banner.classList.add('act');
      banner.textContent = `Best move: ${bestMoveSan}`;
      const from = bestMoveUci.slice(0, 2);
      const to = bestMoveUci.slice(2, 4);
      Board.drawArrow(from, to, puzzle.playerColor);
    }
  }

  function hideSignal() {
    const banner = els['banner'];
    banner.classList.add('hidden');
    banner.textContent = '';
    Board.clearArrows();
  }

  // ---------- move handling ----------

  async function handleDrop(source, target, piece, newPos, oldPos, orientation) {
    if (source === target) return 'snapback';
    // Always promote to queen for MVP
    const move = chess.move({ from: source, to: target, promotion: 'q' });
    if (!move) return 'snapback';

    const timeMs = Math.round(performance.now() - moveStartTs);
    hideSignal();

    const fenBefore = move.before || chess.fen(); // chess.js 0.10.x may not expose .before
    // For v0.10.x, reconstruct fenBefore by undoing + redoing.
    let fenBeforePlayer, fenAfterPlayer;
    try {
      fenAfterPlayer = chess.fen();
      chess.undo();
      fenBeforePlayer = chess.fen();
      chess.move({ from: source, to: target, promotion: 'q' });
    } catch {
      fenBeforePlayer = puzzle.startFen;
      fenAfterPlayer = chess.fen();
    }

    setStatus('Analyzing…');
    const after = await Engine.analyze(fenAfterPlayer);

    const record = {
      moveNumber: moveIdx + 1,
      playerMove: { san: move.san, uci: source + target + (move.promotion ? move.promotion : '') },
      fenBeforePlayer,
      fenAfterPlayer,
      timeMs,
      evalBeforePlayerWhitePov: evalBeforePlayer,
      evalAfterPlayerWhitePov: after.evalWhitePov,
      stockfishReply: null,
      fenAfterStockfish: null,
      evalAfterStockfishWhitePov: null,
    };

    // If we still have moves to make (we need another player move after this),
    // Stockfish replies as opponent.
    const willContinue = (moveIdx + 1) < window.MOVES_PER_PUZZLE;
    if (willContinue && !chess.game_over()) {
      setStatus('Opponent is thinking…');
      const sfBest = after.bestMoveUci;
      if (sfBest) {
        const mvObj = chess.move({
          from: sfBest.slice(0, 2),
          to: sfBest.slice(2, 4),
          promotion: sfBest.length === 5 ? sfBest[4] : undefined,
        });
        if (mvObj) {
          record.stockfishReply = { san: mvObj.san, uci: sfBest };
          record.fenAfterStockfish = chess.fen();
          Board.setPosition(chess.fen());
          const afterSf = await Engine.analyze(chess.fen());
          record.evalAfterStockfishWhitePov = afterSf.evalWhitePov;
          evalBeforePlayer = afterSf.evalWhitePov;
        }
      }
    }

    puzzleRecord.moves.push(record);
    moveIdx += 1;
    Store.update(s => {
      // Only persist in-progress record once committed at puzzle end.
    });

    if (moveIdx >= window.MOVES_PER_PUZZLE || chess.game_over()) {
      await finishPuzzle();
    } else {
      setStatus('Your move.');
      moveStartTs = performance.now();
    }
  }

  async function finishPuzzle() {
    Store.update(s => {
      s.puzzles.push(puzzleRecord);
      s.currentIdx += 1;
    });
    session = Store.load();
    setStatus('Puzzle complete.');
    els['next-button'].classList.remove('hidden');
  }

  function advance() {
    els['next-button'].classList.add('hidden');
    loadNextPuzzle();
  }

  function finishSession() {
    els['experiment-ui'].classList.add('hidden');
    els['finished-ui'].classList.remove('hidden');
    setStatus('All puzzles complete. Please download your session data.');
  }

  // ---------- utils ----------

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return { start, advance };
})();
