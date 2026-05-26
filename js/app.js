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

  if (window.Sync && typeof Sync.checkUsername === 'function') {
    const usernameCheck = await Sync.checkUsername(raw);
    if (!usernameCheck.ok && !usernameCheck.skipped) {
      status.className = 'status error';
      status.textContent = 'Could not verify this username. Please check your internet connection and try again.';
      if (submitButton) submitButton.disabled = false;
      return;
    }
    if (usernameCheck.available === false) {
      status.className = 'status error';
      status.textContent = 'This username has already been used. Please contact the experimenter if this is a mistake.';
      if (submitButton) submitButton.disabled = false;
      return;
    }
  }

  sessionStorage.setItem('participant', JSON.stringify({
    username: raw,
    condition,
    startedAt: Date.now(),
  }));

  status.className = 'status ok';
  status.textContent = `Welcome. Redirecting to experiment…`;
  setTimeout(() => { window.location.href = 'experiment.html'; }, 400);
});
