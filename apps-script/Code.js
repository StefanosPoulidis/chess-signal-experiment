const SECRET = 'DDTXHxAHt-48DhiTAuWC';
const SPREADSHEET_ID = '1cIz9wTJR75FBOqr_oxpW3MbaBCx9fXCIkFnQ9twNFTY';
const USED_USERNAMES_TAB = 'used_usernames';
const USED_USERNAMES_HEADER = ['username', 'condition', 'used_at', 'source'];

function doGet() {
  return out({ ok: true, service: 'chess-signal-experiment' });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return out({ ok: false, error: 'bad secret' });

    const action = data.action || '';
    if (action === 'checkUsername') return handleCheckUsername_(data);
    if (action === 'backfillUsedUsernames') return handleBackfillUsedUsernames_();

    if (!data.tab) return out({ ok: false, error: 'missing tab' });

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (data.tab === 'sessions') return appendSession_(ss, data);

    return appendRows_(ss, data.tab, data.headers, data.rows || []);
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function handleCheckUsername_(data) {
  const username = normalizeUsername_(data.username);
  if (!username) return out({ ok: false, error: 'missing username' });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const used = findUsernameUse_(ss, username);
  return out({
    ok: true,
    username,
    available: !used,
    usedAt: used ? used.usedAt : '',
    source: used ? used.source : '',
  });
}

function appendSession_(ss, data) {
  const rows = data.rows || [];
  if (!rows.length) return appendRows_(ss, data.tab, data.headers, rows);

  const username = normalizeUsername_(rows[0][0]);
  if (!username) return out({ ok: false, error: 'missing username' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const used = findUsernameUse_(ss, username);
    if (used) {
      return out({
        ok: false,
        code: 'username_used',
        error: 'username already used',
        username,
        usedAt: used.usedAt,
        source: used.source,
      });
    }

    const result = appendRows_(ss, data.tab, data.headers, rows);
    markUsernameUsed_(ss, username, rows[0][1] || '', rows[0][4] || new Date().toISOString(), 'sessions');
    result.usernameMarkedUsed = true;
    return out(result);
  } finally {
    lock.releaseLock();
  }
}

function handleBackfillUsedUsernames_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sessions = ss.getSheetByName('sessions');
  if (!sessions || sessions.getLastRow() < 2) {
    ensureUsedUsernamesSheet_(ss);
    return out({ ok: true, appended: 0 });
  }

  const values = sessions.getDataRange().getValues();
  let appended = 0;
  values.slice(1).forEach(row => {
    const username = normalizeUsername_(row[0]);
    if (!username) return;
    if (findUsernameUse_(ss, username, { includeSessions: false })) return;
    markUsernameUsed_(ss, username, row[1] || '', row[4] || new Date().toISOString(), 'sessions_backfill');
    appended += 1;
  });
  return out({ ok: true, appended });
}

function findUsernameUse_(ss, username, opts) {
  const options = opts || {};
  const normalized = normalizeUsername_(username);
  const usedSheet = ss.getSheetByName(USED_USERNAMES_TAB);
  const used = findInSheet_(usedSheet, normalized, 0, 2, 3);
  if (used) return used;

  if (options.includeSessions === false) return null;

  const sessionsSheet = ss.getSheetByName('sessions');
  return findInSheet_(sessionsSheet, normalized, 0, 4, null);
}

function findInSheet_(sheet, username, usernameCol, usedAtCol, sourceCol) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    if (normalizeUsername_(row[usernameCol]) === username) {
      return {
        usedAt: usedAtCol === null ? '' : String(row[usedAtCol] || ''),
        source: sourceCol === null ? sheet.getName() : String(row[sourceCol] || sheet.getName()),
      };
    }
  }
  return null;
}

function markUsernameUsed_(ss, username, condition, usedAt, source) {
  const sheet = ensureUsedUsernamesSheet_(ss);
  if (findUsernameUse_(ss, username, { includeSessions: false })) return;
  sheet.appendRow([username, condition, usedAt, source]);
}

function appendRows_(ss, tab, headers, rows) {
  const sheet = getOrCreateSheet_(ss, tab);
  if (sheet.getLastRow() === 0 && headers) {
    sheet.appendRow(headers);
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  return { ok: true, tab, appended: rows.length };
}

function ensureUsedUsernamesSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, USED_USERNAMES_TAB);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(USED_USERNAMES_HEADER);
  }
  return sheet;
}

function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function normalizeUsername_(username) {
  return String(username || '').trim().toLowerCase();
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
