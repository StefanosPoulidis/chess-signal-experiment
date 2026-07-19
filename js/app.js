'use strict';

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const form = document.getElementById('login-form');
const input = document.getElementById('username');
const status = document.getElementById('status');
const submitButton = form.querySelector('button[type="submit"]');

function makeSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
}

function recoverLocalSession(username) {
  try {
    const saved = JSON.parse(localStorage.getItem('chess-signal-session'));
    if (
      saved &&
      saved.participant &&
      saved.participant.username === username &&
      saved.experimentVersion === (window.CONFIG || {}).experimentVersion &&
      !saved.surveySubmittedAt
    ) {
      return saved.participant;
    }
  } catch { /* start a new claim */ }
  return null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.className = 'status';
  status.textContent = 'Checking…';
  if (submitButton) submitButton.disabled = true;

  const raw = input.value.trim().toLowerCase();
  if (!raw) {
    if (submitButton) submitButton.disabled = false;
    return;
  }

  const hash = await sha256(raw);
  const condition = (window.USERS || {})[hash];

  if (!condition) {
    status.className = 'status error';
    status.textContent = 'Username not recognized. Check spelling and try again.';
    if (submitButton) submitButton.disabled = false;
    return;
  }

  let existingParticipant = null;
  try {
    existingParticipant = JSON.parse(sessionStorage.getItem('participant'));
  } catch { /* start a new claim */ }
  const resumableParticipant = existingParticipant && existingParticipant.username === raw
    ? existingParticipant
    : recoverLocalSession(raw);
  const sessionId = resumableParticipant ? resumableParticipant.sessionId : makeSessionId();

  if (window.Sync && typeof Sync.claimUsername === 'function') {
    const usernameClaim = await Sync.claimUsername(raw, condition, sessionId);
    if (!usernameClaim.ok && !usernameClaim.skipped) {
      status.className = 'status error';
      status.textContent = usernameClaim.code === 'username_used'
        ? 'This username has already been used. Please contact the experimenter if this is a mistake.'
        : 'Could not reserve this username. Please check your internet connection and try again.';
      if (submitButton) submitButton.disabled = false;
      return;
    }
  }

  sessionStorage.setItem('participant', JSON.stringify({
    username: raw,
    condition,
    sessionId,
    startedAt: Date.now(),
  }));

  status.className = 'status ok';
  status.textContent = `Welcome. Redirecting to experiment…`;
  const smokeQuery = (window.CONFIG || {}).localSmokeTest ? window.location.search : '';
  setTimeout(() => { window.location.href = `experiment.html${smokeQuery}`; }, 400);
});
