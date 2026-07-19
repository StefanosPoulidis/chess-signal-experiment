// ============================================================
// Data sync configuration.
// Fill this in AFTER deploying your Google Apps Script Web App.
// See README for setup steps.
// ============================================================

const LOCAL_SMOKE_MODE = new URLSearchParams(window.location.search).get('smoke');
const LOCAL_SMOKE_TEST = Boolean(
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
  LOCAL_SMOKE_MODE
);

window.CONFIG = {
  // Version every substantive protocol or data-schema change.
  experimentVersion: '2026-07-19-total-budget-v1',
  schemaVersion: 2,

  // The clock runs only while the participant can make a move. Engine
  // computation and puzzle transitions are excluded from this budget.
  totalDecisionTimeMs: LOCAL_SMOKE_TEST && LOCAL_SMOKE_MODE === 'timeout'
    ? 8 * 1000
    : 6 * 60 * 1000,
  localSmokeTest: LOCAL_SMOKE_TEST,

  // Apps Script Web App URL.
  webAppUrl: 'https://script.google.com/macros/s/AKfycbxp2kiWBc-8OuOMGKjzyRkYYrFVJL1Xlxz2VlTCt3pehCRUsvfnT3ZF6EDYd3i-lKOZ/exec',

  // Must match the SECRET constant in your Apps Script.
  secret: 'DDTXHxAHt-48DhiTAuWC',

  // Bound login and data-write waits when the backend is unreachable.
  syncTimeoutMs: 20000,

  // Local smoke runs never write to the production spreadsheet.
  skipSync: LOCAL_SMOKE_TEST,
};
