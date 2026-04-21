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
  let evalBeforeMoveCp = null;     // cp at current fen_before_move (white's POV)
  let evalBeforeMoveMate = null;   // mate distance, or null
  let puzzleRecord = null;
  let timerInterval = null;
  let acceptingInput = false;       // true only when it's the player's turn
  let moveTimesThisPuzzle = [];     // seconds, appended per completed move
  let advancing = false;            // guards double-click on "Next puzzle"
  let selectedSquare = null;        // click-to-move: currently selected origin square

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
     'move-counter', 'clock-history', 'next-button',
     'survey-ui', 'survey-form', 'survey-submit', 'survey-status',
     'finished-ui', 'experiment-ui', 'promotion-modal']
      .forEach(id => { els[id] = document.getElementById(id); });
  }

  function setStatus(text) {
    if (els['status']) els['status'].textContent = text;
  }

  function startTimer() {
    stopTimer();
    moveStartTs = performance.now();
    if (!els['timer']) return;
    const update = () => {
      const secs = (performance.now() - moveStartTs) / 1000;
      els['timer'].textContent = secs.toFixed(1);
    };
    update();
    timerInterval = setInterval(update, 100);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function renderClockHistory() {
    const el = els['clock-history'];
    if (!el) return;
    el.innerHTML = '';
    moveTimesThisPuzzle.forEach((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'clock-chip';
      const lbl = document.createElement('span');
      lbl.className = 'chip-label';
      lbl.textContent = `M${i + 1}`;
      const val = document.createElement('span');
      val.textContent = `${t.toFixed(1)}s`;
      chip.appendChild(lbl);
      chip.appendChild(val);
      el.appendChild(chip);
    });
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
    evalBeforeMoveCp = null;
    evalBeforeMoveMate = null;
    moveTimesThisPuzzle = [];
    renderClockHistory();
    if (els['timer']) els['timer'].textContent = '0.0';

    els['condition-badge'].textContent = session.participant.condition.toUpperCase();
    els['condition-badge'].className = 'badge ' + session.participant.condition;
    els['puzzle-indicator'].textContent =
      `Puzzle ${session.currentIdx + 1} of ${session.puzzleOrder.length}`;

    // Initial board
    Board.destroy();
    selectedSquare = null;
    Board.create({
      elementId: 'chess-board',
      fen: puzzle.startFen,
      playerColor: puzzle.playerColor,
      onDrop: handleDrop,
      onDragStart: handleDragStart,
    });
    Board.setupClickHandler(onSquareClick);
    // Small delay so DOM measures correctly
    await new Promise(r => setTimeout(r, 30));
    Board.resize();

    setStatus('Analyzing starting position…');
    const startAnalysis = await Engine.analyze(puzzle.startFen);
    evalBeforeMoveCp = startAnalysis.cp;
    evalBeforeMoveMate = startAnalysis.mate;

    // Prefer the hardcoded puzzle.bestMove for the `act` signal; fall back to
    // Stockfish's live best move if the puzzle doesn't specify one.
    const displayedBestUci = (puzzle.bestMove && isValidUci(puzzle.bestMove))
      ? puzzle.bestMove
      : startAnalysis.bestMoveUci;

    let bestMoveSan = null;
    if (isValidUci(displayedBestUci)) {
      const testChess = new Chess(puzzle.startFen);
      const moveObj = testChess.move({
        from: displayedBestUci.slice(0, 2),
        to: displayedBestUci.slice(2, 4),
        promotion: displayedBestUci.length === 5 ? displayedBestUci[4] : undefined,
      });
      bestMoveSan = moveObj ? moveObj.san : null;
    }

    puzzleRecord = {
      puzzleId: puzzle.id,
      playerColor: puzzle.playerColor,
      puzzleOrder: session.currentIdx + 1,
      startFen: puzzle.startFen,
      startEvalCp: startAnalysis.cp,
      startEvalMate: startAnalysis.mate,
      startBestMoveSan: bestMoveSan,
      startBestMoveUci: displayedBestUci,
      startStockfishBestMoveUci: startAnalysis.bestMoveUci,
      moves: [],
    };

    showSignal(displayedBestUci, bestMoveSan);
    setStatus('Your move.');
    updateMoveCounter();
    acceptingInput = true;
    startTimer();
  }

  function updateMoveCounter() {
    if (els['move-counter']) {
      els['move-counter'].textContent =
        `Move ${moveIdx + 1} of ${window.MOVES_PER_PUZZLE}`;
    }
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
      if (bestMoveSan && isValidUci(bestMoveUci)) {
        banner.textContent = `Best move: ${bestMoveSan}`;
        Board.drawArrow(bestMoveUci.slice(0, 2), bestMoveUci.slice(2, 4), puzzle.playerColor);
      } else {
        // Fallback: don't render a bogus arrow / label.
        banner.textContent = 'No recommended move available for this position.';
      }
    }
  }

  // Valid UCI: 4 chars (e.g., "e2e4") or 5 chars with promotion ("e7e8q"),
  // all chars in a-h / 1-8 for squares, promotion piece in qrbn.
  function isValidUci(uci) {
    if (typeof uci !== 'string') return false;
    if (uci.length !== 4 && uci.length !== 5) return false;
    if (!/^[a-h][1-8][a-h][1-8]([qrbn])?$/.test(uci)) return false;
    return true;
  }

  function hideSignal() {
    const banner = els['banner'];
    banner.classList.add('hidden');
    banner.textContent = '';
    Board.clearArrows();
  }

  // ---------- move handling ----------

  // Prevent dragging opponent pieces or dragging at all when it's not the player's turn.
  function handleDragStart(source, piece) {
    if (!acceptingInput) return false;
    if (!puzzle) return false;
    const playerLetter = puzzle.playerColor === 'white' ? 'w' : 'b';
    if (piece[0] !== playerLetter) return false;
    // Any in-progress click selection should clear on drag start.
    clearSelection();
    return true;
  }

  // Chessboard.js onDrop is sync-only. Returning 'snapback' reverts the piece.
  function handleDrop(source, target, piece, newPos, oldPos, orientation) {
    if (!acceptingInput) return 'snapback';
    if (source === target || target === 'offboard') return 'snapback';
    const accepted = attemptMove(source, target, piece);
    if (accepted === 'promotion') return 'snapback';  // snap back while modal is open
    return accepted ? undefined : 'snapback';
  }

  // Click-to-move: first click selects a friendly piece, second click tries to move.
  function onSquareClick(square) {
    if (!acceptingInput) return;
    const playerLetter = puzzle.playerColor === 'white' ? 'w' : 'b';
    const piece = chess.get(square);

    if (selectedSquare === null) {
      if (!piece || piece.color !== playerLetter) return;
      selectSquare(square);
      return;
    }
    if (square === selectedSquare) {
      clearSelection();
      return;
    }
    if (piece && piece.color === playerLetter) {
      // Switch selection to another friendly piece.
      clearSelection();
      selectSquare(square);
      return;
    }
    // Attempt move from selectedSquare -> square.
    const from = selectedSquare;
    clearSelection();
    const fromPiece = chess.get(from);
    if (!fromPiece) return;
    const pieceStr = fromPiece.color + fromPiece.type.toUpperCase();
    const accepted = attemptMove(from, square, pieceStr);
    // Regular moves are visually synced via Board.setPosition in processValidMove.
    // Promotion moves are synced after the modal choice. Illegal attempts: no-op.
    if (!accepted) {
      // Nothing else to do — illegal-hint already shown.
    }
  }

  function selectSquare(square) {
    selectedSquare = square;
    Board.highlight(square, 'sq-selected');
    const moves = chess.moves({ square, verbose: true });
    for (const m of moves) Board.highlight(m.to, 'sq-target');
  }

  function clearSelection() {
    if (selectedSquare === null) return;
    selectedSquare = null;
    Board.clearHighlight('sq-selected');
    Board.clearHighlight('sq-target');
  }

  // Shared move logic for drag-drop and click-to-move.
  // Returns true if the move was accepted or a promotion modal was opened.
  function attemptMove(source, target, pieceStr) {
    if (source === target) return false;

    // Promotion path: show chooser, leave chess.js state untouched for now.
    if (isPromotionMove(source, target, pieceStr)) {
      const probe = new Chess(chess.fen());
      if (!probe.move({ from: source, to: target, promotion: 'q' })) {
        showIllegalHint();
        return false;
      }
      acceptingInput = false;
      openPromotionModal(source, target);
      // Special sentinel: handleDrop returns 'snapback' so the drag-visual
      // reverts while the modal is open. If the user picks, completePromotion
      // applies the move and Board.setPosition syncs; if they cancel, the
      // pawn is already visually back on its origin square.
      return 'promotion';
    }

    const timeMs = Math.round(performance.now() - moveStartTs);
    const fenBeforePlayer = chess.fen();
    const move = chess.move({ from: source, to: target, promotion: 'q' });
    if (!move) {
      showIllegalHint();
      return false;
    }
    acceptingInput = false;
    stopTimer();
    const fenAfterPlayer = chess.fen();
    processValidMove({ move, source, target, timeMs, fenBeforePlayer, fenAfterPlayer })
      .catch(err => {
        console.error(err);
        setStatus('Error: ' + (err.message || err));
      });
    return true;
  }

  function isPromotionMove(source, target, piece) {
    if (!piece) return false;
    if (piece[1] !== 'P') return false;
    if (piece[0] === 'w' && source[1] === '7' && target[1] === '8') return true;
    if (piece[0] === 'b' && source[1] === '2' && target[1] === '1') return true;
    return false;
  }

  // ---------- promotion chooser ----------

  const PIECE_SYMBOLS = {
    white: { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658' },
    black: { q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E' },
  };

  function openPromotionModal(source, target) {
    const modal = els['promotion-modal'];
    if (!modal) {
      // Fallback: no modal in DOM, just queen-promote.
      completePromotion(source, target, 'q');
      return;
    }
    const symbols = PIECE_SYMBOLS[puzzle.playerColor] || PIECE_SYMBOLS.white;
    const buttons = modal.querySelectorAll('.promo-btn');
    buttons.forEach(btn => {
      const piece = btn.getAttribute('data-piece');
      const name = btn.getAttribute('data-name');
      btn.innerHTML = `<span class="promo-piece">${symbols[piece]}</span><span>${name}</span>`;
      btn.onclick = () => {
        closePromotionModal();
        completePromotion(source, target, piece);
      };
    });
    const overlay = modal.querySelector('.promotion-overlay');
    overlay.onclick = () => {
      closePromotionModal();
      // Pawn is already visually back on source rank (snapback). Let player retry.
      acceptingInput = true;
      setStatus('Your move.');
    };
    modal.classList.remove('hidden');
  }

  function closePromotionModal() {
    const modal = els['promotion-modal'];
    if (modal) modal.classList.add('hidden');
  }

  function completePromotion(source, target, promotion) {
    const timeMs = Math.round(performance.now() - moveStartTs);
    const fenBeforePlayer = chess.fen();
    const move = chess.move({ from: source, to: target, promotion });
    if (!move) {
      // Should not happen (we pre-validated), but restore input if it does.
      acceptingInput = true;
      setStatus('Illegal move — try another.');
      return;
    }
    stopTimer();
    // Snap the board to the correct post-promotion position (pawn -> chosen piece).
    Board.setPosition(chess.fen());
    const fenAfterPlayer = chess.fen();
    processValidMove({ move, source, target, timeMs, fenBeforePlayer, fenAfterPlayer })
      .catch(err => {
        console.error(err);
        setStatus('Error: ' + (err.message || err));
      });
  }

  let illegalHintTimeout = null;
  function showIllegalHint() {
    setStatus('Illegal move — try another.');
    if (illegalHintTimeout) clearTimeout(illegalHintTimeout);
    illegalHintTimeout = setTimeout(() => {
      if (acceptingInput) setStatus('Your move.');
    }, 2500);
  }

  async function processValidMove({ move, source, target, timeMs, fenBeforePlayer, fenAfterPlayer }) {
    hideSignal();
    Board.setPosition(fenAfterPlayer);

    moveTimesThisPuzzle.push(timeMs / 1000);
    renderClockHistory();

    const willContinue = (moveIdx + 1) < window.MOVES_PER_PUZZLE;
    const playerMoveEndedGame = chess.game_over();

    // Let Stockfish think DURING the visible pause. Total wait = max(analysis, 1s).
    // If the player's move ended the game (e.g., delivered mate), skip analysis —
    // asking Stockfish about a terminal position can hang the worker.
    setStatus(willContinue && !playerMoveEndedGame ? 'Opponent is thinking…' : 'Analyzing your move…');
    let after;
    if (playerMoveEndedGame) {
      after = { cp: null, mate: null, bestMoveUci: null };
    } else {
      [after] = await Promise.all([
        Engine.analyze(fenAfterPlayer),
        willContinue ? sleep(1000) : Promise.resolve(),
      ]);
    }

    const record = {
      moveNumber: moveIdx + 1,
      fenBeforeMove: fenBeforePlayer,
      evalBeforeMoveCp: evalBeforeMoveCp,
      evalBeforeMoveMate: evalBeforeMoveMate,
      playerMove: {
        san: move.san,
        uci: source + target + (move.promotion ? move.promotion : ''),
      },
      timeMs,
      fenAfterMove: fenAfterPlayer,
      evalAfterMoveCp: after.cp,
      evalAfterMoveMate: after.mate,
      stockfishReply: null,
      fenAfterStockfish: null,
      evalAfterStockfishCp: null,
      evalAfterStockfishMate: null,
    };

    if (willContinue && !chess.game_over()) {
      const sfBest = after.bestMoveUci;
      if (isValidUci(sfBest)) {
        const mvObj = chess.move({
          from: sfBest.slice(0, 2),
          to: sfBest.slice(2, 4),
          promotion: sfBest.length === 5 ? sfBest[4] : undefined,
        });
        if (mvObj) {
          record.stockfishReply = { san: mvObj.san, uci: sfBest };
          record.fenAfterStockfish = chess.fen();
          Board.setPosition(chess.fen());
          // Skip analysis if Stockfish's reply ended the game (mate / draw) —
          // analyzing a terminal position can hang the worker.
          if (!chess.game_over()) {
            const afterSf = await Engine.analyze(chess.fen());
            record.evalAfterStockfishCp = afterSf.cp;
            record.evalAfterStockfishMate = afterSf.mate;
            evalBeforeMoveCp = afterSf.cp;
            evalBeforeMoveMate = afterSf.mate;
          } else {
            evalBeforeMoveCp = null;
            evalBeforeMoveMate = null;
          }
        }
      }
    }

    puzzleRecord.moves.push(record);
    moveIdx += 1;

    if (moveIdx >= window.MOVES_PER_PUZZLE || chess.game_over()) {
      await finishPuzzle();
    } else {
      setStatus('Your move.');
      updateMoveCounter();
      acceptingInput = true;
      startTimer();
    }
  }

  function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  async function finishPuzzle() {
    stopTimer();
    acceptingInput = false;
    Store.update(s => {
      s.puzzles.push(puzzleRecord);
      s.currentIdx += 1;
    });
    session = Store.load();

    // Push this puzzle's moves to Google Sheets (fire-and-forget).
    Sync.pushMoves(session, puzzleRecord).then(result => {
      if (!result.ok && !result.skipped) {
        console.warn('[Sync] puzzle not saved remotely', result);
      }
    });

    // If the puzzle ended via game-over (checkmate / stalemate / draw),
    // show a brief reason and auto-advance to the next puzzle.
    if (chess.game_over && chess.game_over()) {
      const playerLetter = puzzle.playerColor === 'white' ? 'w' : 'b';
      let msg;
      if (chess.in_checkmate && chess.in_checkmate()) {
        msg = chess.turn() === playerLetter
          ? 'Checkmate — you lost this one.'
          : 'Checkmate — you won!';
      } else if (chess.in_stalemate && chess.in_stalemate()) {
        msg = 'Stalemate.';
      } else if (chess.in_draw && chess.in_draw()) {
        msg = 'Draw.';
      } else {
        msg = 'Puzzle ended.';
      }
      setStatus(msg + ' Moving to the next puzzle…');
      await sleep(1500);
      advance();
      return;
    }

    setStatus('Puzzle complete.');
    els['next-button'].classList.remove('hidden');
  }

  function advance() {
    if (advancing) return;     // guard against double-click
    advancing = true;
    els['next-button'].classList.add('hidden');
    loadNextPuzzle().finally(() => { advancing = false; });
  }

  let puzzlesCompletedAt = null;

  function finishSession() {
    stopTimer();
    acceptingInput = false;
    puzzlesCompletedAt = Date.now();
    Store.update(s => { s.puzzlesCompletedAt = puzzlesCompletedAt; });
    els['experiment-ui'].classList.add('hidden');
    els['survey-ui'].classList.remove('hidden');
  }

  async function submitSurvey(answers) {
    if (els['survey-submit']) els['survey-submit'].disabled = true;
    if (els['survey-status']) {
      els['survey-status'].className = 'status';
      els['survey-status'].textContent = 'Submitting…';
    }
    const state = Store.load();
    const result = await Sync.pushSession(state, answers, state.puzzlesCompletedAt || puzzlesCompletedAt);
    if (!result.ok && !result.skipped) {
      // Leave participant on the survey with an error so they can retry.
      if (els['survey-submit']) els['survey-submit'].disabled = false;
      if (els['survey-status']) {
        els['survey-status'].className = 'status error';
        els['survey-status'].textContent = 'Submission failed — please try again or notify the experimenter.';
      }
      return;
    }
    els['survey-ui'].classList.add('hidden');
    els['finished-ui'].classList.remove('hidden');
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

  return { start, advance, submitSurvey };
})();
