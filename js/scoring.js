'use strict';

// Position and move-quality measures from Appendix C.2 of the June 2025
// Action vs. Attention Signals paper. Win percentage is on a 0-100 scale;
// win probability is the same measure divided by 100.

window.Scoring = (() => {
  const METHOD_VERSION = 'action-attention-paper-appendix-c2-v1';
  const WIN_PERCENTAGE_SLOPE = 0.00368208;
  const ACCURACY_SCALE = 103.1668;
  const ACCURACY_DECAY = 0.04354;
  const ACCURACY_OFFSET = 3.1669;
  const DECIMAL_PLACES = 6;

  function numeric(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function rounded(value) {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(DECIMAL_PLACES));
  }

  function participantCp(cp, playerColor) {
    const value = numeric(cp);
    if (value === null) return null;
    return playerColor === 'black' ? -value : value;
  }

  function winPercentageFromCp(cp) {
    const value = numeric(cp);
    if (value === null) return null;
    return rounded(100 / (1 + Math.exp(-WIN_PERCENTAGE_SLOPE * value)));
  }

  function terminalWhiteWinPercentage(terminalOutcome) {
    if (!terminalOutcome) return null;
    if (terminalOutcome === 'black_checkmated' || terminalOutcome === 'white_won') return 100;
    if (terminalOutcome === 'white_checkmated' || terminalOutcome === 'black_won') return 0;
    if (String(terminalOutcome).startsWith('draw_')) return 50;
    return null;
  }

  function positionMetrics(cp, playerColor, terminalOutcome) {
    const terminalWhite = terminalWhiteWinPercentage(terminalOutcome);
    const whiteWinPercentage = terminalWhite === null
      ? winPercentageFromCp(cp)
      : terminalWhite;
    const participantWinPercentage = whiteWinPercentage === null
      ? null
      : rounded(playerColor === 'black' ? 100 - whiteWinPercentage : whiteWinPercentage);
    return {
      whiteWinPercentage,
      participantWinPercentage,
      whiteWinProbability: whiteWinPercentage === null ? null : rounded(whiteWinPercentage / 100),
      participantWinProbability: participantWinPercentage === null
        ? null
        : rounded(participantWinPercentage / 100),
    };
  }

  function moveAccuracy(beforeWinPercentage, afterWinPercentage) {
    const before = numeric(beforeWinPercentage);
    const after = numeric(afterWinPercentage);
    if (before === null || after === null) {
      return { raw: null, value: null, valid: false, invalidReason: 'missing_win_percentage' };
    }
    const raw = ACCURACY_SCALE * Math.exp(-ACCURACY_DECAY * (before - after)) - ACCURACY_OFFSET;
    if (!Number.isFinite(raw)) {
      return { raw: null, value: null, valid: false, invalidReason: 'non_finite' };
    }
    const roundedRaw = rounded(raw);
    if (raw < 0 || raw > 100) {
      return { raw: roundedRaw, value: null, valid: false, invalidReason: 'out_of_range' };
    }
    return { raw: roundedRaw, value: roundedRaw, valid: true, invalidReason: '' };
  }

  function difference(after, before) {
    const afterValue = numeric(after);
    const beforeValue = numeric(before);
    return afterValue === null || beforeValue === null
      ? null
      : rounded(afterValue - beforeValue);
  }

  function metadata() {
    return {
      methodVersion: METHOD_VERSION,
      winPercentageSlope: WIN_PERCENTAGE_SLOPE,
      accuracyScale: ACCURACY_SCALE,
      accuracyDecay: ACCURACY_DECAY,
      accuracyOffset: ACCURACY_OFFSET,
    };
  }

  return {
    participantCp,
    winPercentageFromCp,
    terminalWhiteWinPercentage,
    positionMetrics,
    moveAccuracy,
    difference,
    metadata,
  };
})();
