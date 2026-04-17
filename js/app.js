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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.className = 'status';
  status.textContent = 'Checking…';

  const raw = input.value.trim().toLowerCase();
  if (!raw) return;

  const hash = await sha256(raw);
  const condition = (window.USERS || {})[hash];

  if (!condition) {
    status.className = 'status error';
    status.textContent = 'Username not recognized. Check spelling and try again.';
    return;
  }

  sessionStorage.setItem('participant', JSON.stringify({
    username: raw,
    condition,
    startedAt: Date.now(),
  }));

  status.className = 'status ok';
  status.textContent = `Welcome. Condition assigned: ${condition}. (Experiment flow — Phase 2 — coming soon.)`;
  input.disabled = true;
  form.querySelector('button').disabled = true;
});
