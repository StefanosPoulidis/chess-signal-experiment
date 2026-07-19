'use strict';

// Experiment flow: six randomized puzzles, a persistent six-minute active
// decision-time budget, condition-specific first-move signals, and survey sync.

window.Game = (() => {
  const els = {};
  let session = null;
  let puzzle = null;
  let chess = null;
  let puzzleRecord = null;
  let moveIdx = 0;
  let timerInterval = null;
  let timerDeadline = null;
  let acceptingInput = false;
  let advancing = false;
  let timingOut = false;
  let selectedSquare = null;
  let illegalHintTimeout = null;

  const LIKERT_OPTIONS = [
    { value: 'strongly_disagree', label: 'Strongly disagree' },
    { value: 'disagree', label: 'Disagree' },
    { value: 'neither', label: 'Neither agree nor disagree' },
    { value: 'agree', label: 'Agree' },
    { value: 'strongly_agree', label: 'Strongly agree' },
  ];

  const YES_NO_OPTIONS = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ];

  const SURVEY_QUESTIONS = [
    {
      name: 'q1',
      text: 'Before making my first move, I tried to understand the idea of the position and plan what I would do next.',
      options: LIKERT_OPTIONS,
    },
    {
      name: 'q2',
      text: 'After making the first move, I often felt lost in the continuation.',
      options: LIKERT_OPTIONS,
    },
    {
      name: 'q3',
      text: 'The first move sometimes led to positions that were harder to continue than I expected.',
      options: LIKERT_OPTIONS,
    },
    {
      name: 'q4',
      text: 'The six-minute total time budget affected how I allocated my time across moves and puzzles.',
      options: LIKERT_OPTIONS,
    },
    {
      name: 'q6',
      text: 'Did you use any outside help while completing the chess task, such as a chess engine, chess website, book, coach, parent, friend, or any other assistance?',
      options: YES_NO_OPTIONS,
    },
    {
      name: 'q7',
      condition: 'act',
      text: 'When I was shown the recommended move, I followed it even if I did not fully understand why it was good.',
      options: LIKERT_OPTIONS,
    },
    {
      name: 'q7',
      condition: 'att',
      text: 'Because I was told there was a unique best move, I looked more carefully than I would in a normal game.',
      options: LIKERT_OPTIONS,
    },
  ];

  function config() {
    return window.CONFIG || {};
  }

  async function start() {
    cacheEls();
    const participantRaw = sessionStorage.getItem('participant');
    if (!participantRaw) {
      window.location.href = 'index.html';
      return;
    }
    const participant = JSON.parse(participantRaw);
    const existing = Store.load();
    const canResume = existing &&
      existing.participant.username === participant.username &&
      existing.sessionId === participant.sessionId &&
      existing.experimentVersion === config().experimentVersion;

    const puzzleOrder = config().localSmokeTest
      ? PUZZLES.map(item => item.id)
      : shuffle(PUZZLES.map(item => item.id));
    session = canResume
      ? existing
      : Store.init(participant, puzzleOrder, config());

    if (session.surveySubmittedAt) {
      showFinished();
      return;
    }
    if (session.taskStatus !== 'in_progress') {
      showSurvey();
      return;
    }

    setStatus('Loading engine...');
    await Engine.init();

    if (Store.remainingDecisionMs(session) <= 0) {
      await expireTimeBudget();
    } else if (session.activePuzzle) {
      await resumeActivePuzzle();
    } else {
      await loadNextPuzzle();
    }
  }

  function cacheEls() {
    [
      'status', 'puzzle-indicator', 'condition-badge', 'banner', 'timer',
      'move-counter', 'next-button', 'survey-ui', 'survey-form', 'survey-fields',
      'survey-submit', 'survey-status', 'survey-intro', 'finished-ui',
      'experiment-ui', 'promotion-modal',
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function formatRemaining(ms) {
    const tenths = Math.max(0, Math.ceil(ms / 100) / 10);
    const minutes = Math.floor(tenths / 60);
    const seconds = (tenths - minutes * 60).toFixed(1).padStart(4, '0');
    return `${minutes}:${seconds}`;
  }

  function renderClock() {
    session = Store.load();
    const remaining = Store.remainingDecisionMs(session);
    if (els.timer) els.timer.textContent = formatRemaining(remaining);
    const clock = els.timer ? els.timer.closest('.chess-clock') : null;
    if (clock) {
      clock.classList.toggle('clock-warning', remaining > 0 && remaining <= 60000);
      clock.classList.toggle('clock-expired', remaining <= 0);
    }
    if (remaining <= 0 && acceptingInput) expireTimeBudget();
  }

  function stopClockUi() {
    if (timerInterval) clearInterval(timerInterval);
    if (timerDeadline) clearTimeout(timerDeadline);
    timerInterval = null;
    timerDeadline = null;
  }

  function startDecisionClock() {
    stopClockUi();
    const timing = Store.beginDecisionTurn();
    session = timing.state;
    puzzleRecord = session.activePuzzle;
    if (!timing.started || timing.remainingMs <= 0) {
      expireTimeBudget();
      return false;
    }
    renderClock();
    timerInterval = setInterval(renderClock, 100);
    timerDeadline = setTimeout(expireTimeBudget, timing.remainingMs + 25);
    return true;
  }

  function pauseDecisionClock() {
    stopClockUi();
    const timing = Store.pauseDecisionTurn();
    session = timing.state;
    puzzleRecord = session.activePuzzle;
    renderClock();
    return timing;
  }

  async function loadNextPuzzle() {
    session = Store.load();
    if (session.currentIdx >= session.puzzleOrder.length) {
      finishCompletedSession();
      return;
    }
    if (Store.remainingDecisionMs(session) <= 0) {
      await expireTimeBudget();
      return;
    }

    const puzzleId = session.puzzleOrder[session.currentIdx];
    puzzle = PUZZLES.find(item => item.id === puzzleId);
    chess = new Chess(puzzle.startFen);
    moveIdx = 0;
    preparePuzzleUi(puzzle.startFen, session.currentIdx + 1);

    setStatus('Analyzing starting position...');
    const startAnalysis = await analyzePosition(chess);
    const signal = getSignalMove(puzzle, startAnalysis);
    const remaining = Store.remainingDecisionMs(Store.load());

    puzzleRecord = {
      puzzleId: puzzle.id,
      playerColor: puzzle.playerColor,
      puzzleOrder: session.currentIdx + 1,
      startFen: puzzle.startFen,
      startEvalCp: startAnalysis.cp,
      startEvalMate: startAnalysis.mate,
      startBestMoveSan: signal.san,
      startBestMoveUci: signal.uci,
      startStockfishBestMoveUci: startAnalysis.bestMoveUci,
      status: 'in_progress',
      endReason: '',
      startedAt: Date.now(),
      endedAt: null,
      completedBeforeTimeout: null,
      puzzleStartedRemainingMs: remaining,
      puzzleEndedRemainingMs: null,
      currentFen: puzzle.startFen,
      currentEvalCp: startAnalysis.cp,
      currentEvalMate: startAnalysis.mate,
      terminalOutcome: '',
      moveStartedRemainingMs: null,
      pendingMove: null,
      moves: [],
    };
    persistActivePuzzle();

    showSignal(signal.uci, signal.san);
    setStatus('Your move.');
    updateMoveCounter();
    acceptingInput = true;
    startDecisionClock();
  }

  async function resumeActivePuzzle() {
    session = Store.load();
    puzzleRecord = session.activePuzzle;
    puzzle = PUZZLES.find(item => item.id === puzzleRecord.puzzleId);
    chess = new Chess(puzzleRecord.currentFen || puzzle.startFen);
    moveIdx = (puzzleRecord.moves || []).length;
    preparePuzzleUi(chess.fen(), puzzleRecord.puzzleOrder);

    if (puzzleRecord.pendingMove) {
      hideSignal();
      await processPendingMove();
      return;
    }

    if (moveIdx === 0) {
      showSignal(puzzleRecord.startBestMoveUci, puzzleRecord.startBestMoveSan);
    } else {
      hideSignal();
    }
    setStatus('Your move.');
    updateMoveCounter();
    acceptingInput = true;
    startDecisionClock();
  }

  function preparePuzzleUi(fen, order) {
    acceptingInput = false;
    selectedSquare = null;
    els['next-button'].classList.add('hidden');
    els['condition-badge'].textContent = session.participant.condition.toUpperCase();
    els['condition-badge'].className = `badge ${session.participant.condition}`;
    els['puzzle-indicator'].textContent = `Puzzle ${order} of ${session.puzzleOrder.length}`;
    Board.destroy();
    Board.create({
      elementId: 'chess-board',
      fen,
      playerColor: puzzle.playerColor,
      onDrop: handleDrop,
      onDragStart: handleDragStart,
    });
    Board.setupClickHandler(onSquareClick);
    setTimeout(() => Board.resize(), 30);
    renderClock();
  }

  function updateMoveCounter() {
    if (els['move-counter']) {
      els['move-counter'].textContent = `Move ${moveIdx + 1} of ${window.MOVES_PER_PUZZLE}`;
    }
  }

  function getSignalMove(spec, analysis) {
    const uci = spec.bestMove && isValidUci(spec.bestMove)
      ? spec.bestMove
      : analysis.bestMoveUci;
    if (!isValidUci(uci)) return { uci: '', san: '' };
    const position = new Chess(spec.startFen);
    const move = position.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length === 5 ? uci[4] : undefined,
    });
    return { uci, san: move ? move.san : '' };
  }

  function showSignal(bestMoveUci, bestMoveSan) {
    const banner = els.banner;
    banner.classList.remove('hidden', 'att', 'act');
    if (session.participant.condition === 'att') {
      banner.classList.add('att');
      banner.textContent = 'There is a unique optimal move here!';
      return;
    }
    banner.classList.add('act');
    if (bestMoveSan && isValidUci(bestMoveUci)) {
      banner.textContent = `Best move: ${bestMoveSan}`;
      Board.drawArrow(bestMoveUci.slice(0, 2), bestMoveUci.slice(2, 4), puzzle.playerColor);
    } else {
      banner.textContent = 'No recommended move available for this position.';
    }
  }

  function hideSignal() {
    if (!els.banner) return;
    els.banner.classList.add('hidden');
    els.banner.textContent = '';
    Board.clearArrows();
  }

  function isValidUci(uci) {
    return typeof uci === 'string' && /^[a-h][1-8][a-h][1-8]([qrbn])?$/.test(uci);
  }

  function persistActivePuzzle() {
    session = Store.update(state => { state.activePuzzle = puzzleRecord; });
  }

  function handleDragStart(source, piece) {
    if (!acceptingInput || !puzzle) return false;
    const playerLetter = puzzle.playerColor === 'white' ? 'w' : 'b';
    if (piece[0] !== playerLetter) return false;
    clearSelection();
    return true;
  }

  function handleDrop(source, target, piece) {
    if (!acceptingInput || source === target || target === 'offboard') return 'snapback';
    const accepted = attemptMove(source, target, piece);
    if (accepted === 'promotion') return 'snapback';
    return accepted ? undefined : 'snapback';
  }

  function onSquareClick(square) {
    if (!acceptingInput) return;
    const playerLetter = puzzle.playerColor === 'white' ? 'w' : 'b';
    const piece = chess.get(square);
    if (selectedSquare === null) {
      if (piece && piece.color === playerLetter) selectSquare(square);
      return;
    }
    if (square === selectedSquare) {
      clearSelection();
      return;
    }
    if (piece && piece.color === playerLetter) {
      clearSelection();
      selectSquare(square);
      return;
    }
    const source = selectedSquare;
    clearSelection();
    const sourcePiece = chess.get(source);
    if (!sourcePiece) return;
    attemptMove(source, square, sourcePiece.color + sourcePiece.type.toUpperCase());
  }

  function selectSquare(square) {
    selectedSquare = square;
    Board.highlight(square, 'sq-selected');
    chess.moves({ square, verbose: true }).forEach(move => Board.highlight(move.to, 'sq-target'));
  }

  function clearSelection() {
    if (selectedSquare === null) return;
    selectedSquare = null;
    Board.clearHighlight('sq-selected');
    Board.clearHighlight('sq-target');
  }

  function attemptMove(source, target, pieceString) {
    session = Store.load();
    if (Store.remainingDecisionMs(session) <= 0) {
      expireTimeBudget();
      return false;
    }
    if (isPromotionMove(source, target, pieceString)) {
      const probe = new Chess(chess.fen());
      if (!probe.move({ from: source, to: target, promotion: 'q' })) {
        showIllegalHint();
        return false;
      }
      acceptingInput = false;
      openPromotionModal(source, target);
      return 'promotion';
    }
    return commitMove(source, target, 'q');
  }

  function commitMove(source, target, promotion) {
    const fenBeforeMove = chess.fen();
    const move = chess.move({ from: source, to: target, promotion });
    if (!move) {
      showIllegalHint();
      return false;
    }
    acceptingInput = false;
    const timing = pauseDecisionClock();
    const fenAfterMove = chess.fen();
    puzzleRecord.pendingMove = {
      moveNumber: moveIdx + 1,
      fenBeforeMove,
      evalBeforeMoveCp: puzzleRecord.currentEvalCp,
      evalBeforeMoveMate: puzzleRecord.currentEvalMate,
      playerMove: {
        san: move.san,
        uci: source + target + (move.promotion || ''),
      },
      timeMs: timing.elapsedMs,
      moveStartedRemainingMs: timing.moveStartedRemainingMs,
      moveEndedRemainingMs: timing.remainingMs,
      cumulativeDecisionTimeMs: timing.cumulativeDecisionTimeMs,
      fenAfterMove,
    };
    puzzleRecord.currentFen = fenAfterMove;
    persistActivePuzzle();
    hideSignal();
    Board.setPosition(fenAfterMove);
    processPendingMove().catch(handleFatalError);
    return true;
  }

  function isPromotionMove(source, target, piece) {
    if (!piece || piece[1] !== 'P') return false;
    return (piece[0] === 'w' && source[1] === '7' && target[1] === '8') ||
      (piece[0] === 'b' && source[1] === '2' && target[1] === '1');
  }

  const PIECE_SYMBOLS = {
    white: { q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658' },
    black: { q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E' },
  };

  function openPromotionModal(source, target) {
    const modal = els['promotion-modal'];
    if (!modal) {
      commitMove(source, target, 'q');
      return;
    }
    const symbols = PIECE_SYMBOLS[puzzle.playerColor] || PIECE_SYMBOLS.white;
    modal.querySelectorAll('.promo-btn').forEach(button => {
      const piece = button.getAttribute('data-piece');
      const name = button.getAttribute('data-name');
      button.innerHTML = `<span class="promo-piece">${symbols[piece]}</span><span>${name}</span>`;
      button.onclick = () => {
        closePromotionModal();
        commitMove(source, target, piece);
      };
    });
    modal.querySelector('.promotion-overlay').onclick = () => {
      closePromotionModal();
      acceptingInput = true;
      setStatus('Your move.');
    };
    modal.classList.remove('hidden');
  }

  function closePromotionModal() {
    if (els['promotion-modal']) els['promotion-modal'].classList.add('hidden');
  }

  function showIllegalHint() {
    setStatus('Illegal move - try another.');
    if (illegalHintTimeout) clearTimeout(illegalHintTimeout);
    illegalHintTimeout = setTimeout(() => {
      if (acceptingInput) setStatus('Your move.');
    }, 2500);
  }

  async function processPendingMove() {
    puzzleRecord = Store.load().activePuzzle;
    const pending = puzzleRecord.pendingMove;
    if (!pending) return;
    chess = new Chess(pending.fenAfterMove);
    const willContinue = pending.moveNumber < window.MOVES_PER_PUZZLE;
    setStatus(willContinue && !chess.game_over() ? 'Opponent is thinking...' : 'Analyzing your move...');

    const afterPlayer = await analyzePosition(chess);
    const moveRecord = {
      moveNumber: pending.moveNumber,
      fenBeforeMove: pending.fenBeforeMove,
      evalBeforeMoveCp: pending.evalBeforeMoveCp,
      evalBeforeMoveMate: pending.evalBeforeMoveMate,
      playerMove: pending.playerMove,
      timeMs: pending.timeMs,
      moveStartedRemainingMs: pending.moveStartedRemainingMs,
      moveEndedRemainingMs: pending.moveEndedRemainingMs,
      cumulativeDecisionTimeMs: pending.cumulativeDecisionTimeMs,
      fenAfterMove: pending.fenAfterMove,
      evalAfterMoveCp: afterPlayer.cp,
      evalAfterMoveMate: afterPlayer.mate,
      terminalOutcomeAfterPlayer: afterPlayer.terminalOutcome,
      stockfishReply: null,
      fenAfterStockfish: null,
      evalAfterStockfishCp: null,
      evalAfterStockfishMate: null,
      terminalOutcomeAfterStockfish: '',
    };

    let currentAnalysis = afterPlayer;
    if (willContinue && !chess.game_over()) {
      if (!isValidUci(afterPlayer.bestMoveUci)) {
        throw new Error('The chess engine did not return an opponent move. Please reload this page to retry.');
      }
      const opponentMove = chess.move({
        from: afterPlayer.bestMoveUci.slice(0, 2),
        to: afterPlayer.bestMoveUci.slice(2, 4),
        promotion: afterPlayer.bestMoveUci.length === 5 ? afterPlayer.bestMoveUci[4] : undefined,
      });
      if (!opponentMove) {
        throw new Error('The chess engine returned an illegal opponent move. Please reload this page to retry.');
      }
      moveRecord.stockfishReply = { san: opponentMove.san, uci: afterPlayer.bestMoveUci };
      moveRecord.fenAfterStockfish = chess.fen();
      Board.setPosition(chess.fen());
      currentAnalysis = await analyzePosition(chess);
      moveRecord.evalAfterStockfishCp = currentAnalysis.cp;
      moveRecord.evalAfterStockfishMate = currentAnalysis.mate;
      moveRecord.terminalOutcomeAfterStockfish = currentAnalysis.terminalOutcome;
    }

    puzzleRecord.moves.push(moveRecord);
    puzzleRecord.pendingMove = null;
    puzzleRecord.currentFen = chess.fen();
    puzzleRecord.currentEvalCp = currentAnalysis.cp;
    puzzleRecord.currentEvalMate = currentAnalysis.mate;
    puzzleRecord.terminalOutcome = currentAnalysis.terminalOutcome;
    moveIdx = puzzleRecord.moves.length;
    persistActivePuzzle();

    if (moveIdx >= window.MOVES_PER_PUZZLE || chess.game_over()) {
      await finishPuzzle(chess.game_over() ? 'completed_terminal' : 'completed_horizon');
      return;
    }

    setStatus('Your move.');
    updateMoveCounter();
    acceptingInput = true;
    startDecisionClock();
  }

  function terminalEvaluation(position) {
    if (!position.game_over()) return null;
    if (position.in_checkmate()) {
      const whiteMated = position.turn() === 'w';
      return {
        cp: whiteMated ? -10000 : 10000,
        mate: whiteMated ? -1 : 1,
        bestMoveUci: '(none)',
        terminalOutcome: whiteMated ? 'white_checkmated' : 'black_checkmated',
      };
    }
    let outcome = 'draw_other';
    if (position.in_stalemate && position.in_stalemate()) outcome = 'draw_stalemate';
    else if (position.in_threefold_repetition && position.in_threefold_repetition()) outcome = 'draw_threefold';
    else if (position.insufficient_material && position.insufficient_material()) outcome = 'draw_insufficient_material';
    return { cp: 0, mate: null, bestMoveUci: '(none)', terminalOutcome: outcome };
  }

  async function analyzePosition(position) {
    const terminal = terminalEvaluation(position);
    if (terminal) return terminal;
    const result = await Engine.analyze(position.fen());
    return { ...result, terminalOutcome: '' };
  }

  async function finishPuzzle(completionStatus) {
    stopClockUi();
    acceptingInput = false;
    const remaining = Store.remainingDecisionMs(Store.load());
    puzzleRecord.status = completionStatus;
    puzzleRecord.endReason = completionStatus === 'completed_terminal'
      ? (puzzleRecord.terminalOutcome || 'game_over')
      : 'move_horizon_reached';
    puzzleRecord.endedAt = Date.now();
    puzzleRecord.completedBeforeTimeout = true;
    puzzleRecord.puzzleEndedRemainingMs = remaining;
    puzzleRecord.finalFen = puzzleRecord.currentFen;
    puzzleRecord.finalEvalCp = puzzleRecord.currentEvalCp;
    puzzleRecord.finalEvalMate = puzzleRecord.currentEvalMate;

    session = Store.update(state => {
      state.puzzles.push(puzzleRecord);
      state.activePuzzle = null;
      state.currentIdx += 1;
    });
    Sync.pushPuzzleData(session, puzzleRecord).then(result => {
      if (!result.ok && !result.skipped) console.warn('[Sync] puzzle sync deferred', result);
    });

    if (completionStatus === 'completed_terminal') {
      setStatus(`${terminalMessage(chess)} Moving to the next puzzle...`);
      await sleep(1200);
      advance();
      return;
    }
    setStatus('Puzzle complete.');
    els['next-button'].classList.remove('hidden');
  }

  function terminalMessage(position) {
    const playerLetter = puzzle.playerColor === 'white' ? 'w' : 'b';
    if (position.in_checkmate && position.in_checkmate()) {
      return position.turn() === playerLetter ? 'Checkmate - you lost.' : 'Checkmate - you won.';
    }
    if (position.in_stalemate && position.in_stalemate()) return 'Stalemate.';
    return 'Draw.';
  }

  function advance() {
    if (advancing || timingOut) return;
    advancing = true;
    els['next-button'].classList.add('hidden');
    loadNextPuzzle()
      .catch(handleFatalError)
      .finally(() => { advancing = false; });
  }

  async function expireTimeBudget() {
    if (timingOut) return;
    session = Store.load();
    if (!session || session.taskStatus !== 'in_progress') return;
    timingOut = true;
    acceptingInput = false;
    clearSelection();
    closePromotionModal();
    stopClockUi();
    Store.pauseDecisionTurn();
    session = Store.load();
    if (els.timer) els.timer.textContent = formatRemaining(0);
    hideSignal();
    setStatus('Time is up. Finalizing your chess results...');

    const timeoutRecords = [];
    if (session.activePuzzle) {
      const active = session.activePuzzle;
      active.status = 'timed_out';
      active.endReason = 'total_time_budget_expired';
      active.endedAt = Date.now();
      active.completedBeforeTimeout = false;
      active.puzzleEndedRemainingMs = 0;
      active.finalFen = active.currentFen;
      active.finalEvalCp = active.currentEvalCp;
      active.finalEvalMate = active.currentEvalMate;
      timeoutRecords.push(active);
    }

    const firstUnstartedIndex = session.currentIdx + (session.activePuzzle ? 1 : 0);
    for (let index = firstUnstartedIndex; index < session.puzzleOrder.length; index += 1) {
      const spec = PUZZLES.find(item => item.id === session.puzzleOrder[index]);
      const signal = getSignalMove(spec, { bestMoveUci: spec.bestMove || '' });
      timeoutRecords.push({
        puzzleId: spec.id,
        playerColor: spec.playerColor,
        puzzleOrder: index + 1,
        startFen: spec.startFen,
        startEvalCp: null,
        startEvalMate: null,
        startBestMoveSan: signal.san,
        startBestMoveUci: signal.uci,
        startStockfishBestMoveUci: '',
        status: 'not_started_timeout',
        endReason: 'total_time_budget_expired_before_puzzle',
        startedAt: null,
        endedAt: Date.now(),
        completedBeforeTimeout: false,
        puzzleStartedRemainingMs: 0,
        puzzleEndedRemainingMs: 0,
        currentFen: spec.startFen,
        currentEvalCp: null,
        currentEvalMate: null,
        terminalOutcome: '',
        finalFen: spec.startFen,
        finalEvalCp: null,
        finalEvalMate: null,
        pendingMove: null,
        moves: [],
      });
    }

    session = Store.update(state => {
      state.puzzles.push(...timeoutRecords);
      state.activePuzzle = null;
      state.currentIdx = state.puzzleOrder.length;
      state.taskStatus = 'timed_out';
      state.decisionTimeUsedMs = state.totalDecisionTimeMs;
      state.activeDecisionStartedAt = null;
      state.chessTaskEndedAt = Date.now();
    });
    const timeoutSync = await Sync.pushPuzzlesData(session, timeoutRecords);
    if (!timeoutSync.ok && !timeoutSync.skipped) {
      console.warn('[Sync] timeout puzzle sync deferred', timeoutSync);
    }
    showSurvey();
    timingOut = false;
  }

  function finishCompletedSession() {
    stopClockUi();
    acceptingInput = false;
    session = Store.update(state => {
      state.taskStatus = 'completed';
      state.chessTaskEndedAt = Date.now();
    });
    showSurvey();
  }

  function showSurvey() {
    session = Store.load();
    renderSurvey(session.participant.condition, session.surveyAnswers || {});
    els['experiment-ui'].classList.add('hidden');
    els['finished-ui'].classList.add('hidden');
    els['survey-ui'].classList.remove('hidden');
    if (els['survey-intro']) {
      els['survey-intro'].textContent = session.taskStatus === 'timed_out'
        ? 'The six-minute chess task has ended. Please answer the questions below to complete your participation.'
        : 'You have completed the chess puzzles. Please answer the questions below to complete your participation.';
    }
  }

  function renderSurvey(condition, savedAnswers) {
    const container = els['survey-fields'];
    if (!container) return;
    container.innerHTML = '';
    const questions = SURVEY_QUESTIONS.filter(item => !item.condition || item.condition === condition);
    questions.forEach((question, index) => {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'survey-field';
      const legend = document.createElement('legend');
      legend.className = 'survey-question';
      legend.textContent = `${index + 1}. ${question.text}`;
      fieldset.appendChild(legend);
      const options = document.createElement('div');
      options.className = 'survey-options';
      question.options.forEach(option => {
        const id = `survey-${question.name}-${option.value}`;
        const label = document.createElement('label');
        label.className = 'survey-option';
        label.setAttribute('for', id);
        const input = document.createElement('input');
        input.type = 'radio';
        input.id = id;
        input.name = question.name;
        input.value = option.value;
        input.required = true;
        input.checked = savedAnswers[question.name] === option.value;
        const text = document.createElement('span');
        text.textContent = option.label;
        label.appendChild(input);
        label.appendChild(text);
        options.appendChild(label);
      });
      fieldset.appendChild(options);
      container.appendChild(fieldset);
    });
  }

  async function submitSurvey(answers) {
    if (els['survey-submit']) els['survey-submit'].disabled = true;
    if (els['survey-status']) {
      els['survey-status'].className = 'status';
      els['survey-status'].textContent = 'Submitting...';
    }
    session = Store.update(state => {
      state.surveyAnswers = answers;
      state.dataQualityExclude = answers.q6 === 'yes';
      state.dataQualityReason = answers.q6 === 'yes' ? 'reported_outside_help' : '';
    });
    const result = await Sync.flushSession(session, answers);
    if (!result.ok && !result.skipped) {
      if (els['survey-submit']) els['survey-submit'].disabled = false;
      if (els['survey-status']) {
        els['survey-status'].className = 'status error';
        els['survey-status'].textContent = 'Submission failed - please try again or notify the experimenter.';
      }
      return;
    }
    session = Store.update(state => { state.surveySubmittedAt = Date.now(); });
    showFinished();
  }

  function showFinished() {
    if (els['experiment-ui']) els['experiment-ui'].classList.add('hidden');
    if (els['survey-ui']) els['survey-ui'].classList.add('hidden');
    if (els['finished-ui']) els['finished-ui'].classList.remove('hidden');
  }

  function handleFatalError(error) {
    console.error(error);
    acceptingInput = false;
    stopClockUi();
    Store.pauseDecisionTurn();
    setStatus(`Error: ${error.message || error}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  return {
    start,
    advance,
    submitSurvey,
    _test: { formatRemaining, terminalEvaluation, isValidUci },
  };
})();
