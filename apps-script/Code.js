const SECRET = 'DDTXHxAHt-48DhiTAuWC';
const SPREADSHEET_ID = '1cIz9wTJR75FBOqr_oxpW3MbaBCx9fXCIkFnQ9twNFTY';
const USERNAMES_TAB = 'Usernames';
const USED_USERNAMES_TAB = 'used_usernames';
const USED_USERNAMES_HEADER = [
  'username', 'condition', 'claimed_at', 'source',
  'session_id', 'status', 'completed_at',
];

const DATASET_SCHEMAS = {
  sessions: {
    key: 'session_id',
    headers: [
      'username', 'condition', 'session_id', 'experiment_version', 'schema_version',
      'started_at', 'chess_task_ended_at', 'survey_submitted_at', 'task_status',
      'total_budget_ms', 'decision_time_used_ms', 'decision_time_remaining_ms',
      'puzzles_completed_before_timeout', 'puzzles_timed_out_or_unstarted',
      'puzzle_order_played', 'survey_q1', 'survey_q2', 'survey_q3', 'survey_q4',
      'survey_q5_removed', 'survey_q6_outside_help_used',
      'survey_q7_condition_specific', 'data_quality_exclude', 'data_quality_reason',
    ],
  },
  puzzles: {
    key: 'puzzle_record_id',
    headers: [
      'puzzle_record_id', 'session_id', 'username', 'condition',
      'experiment_version', 'schema_version', 'puzzle_id', 'puzzle_order',
      'player_color', 'start_fen', 'status', 'end_reason', 'started_at', 'ended_at',
      'completed_before_timeout', 'moves_completed', 'puzzle_started_remaining_ms',
      'puzzle_ended_remaining_ms', 'start_eval_cp_white',
      'start_eval_cp_participant', 'start_eval_mate_white', 'start_best_move_san',
      'start_best_move_uci', 'start_stockfish_best_move_uci', 'final_fen',
      'final_eval_cp_white', 'final_eval_cp_participant', 'final_eval_mate_white',
      'terminal_outcome', 'first_move_san', 'first_move_uci',
      'followed_action_recommendation',
    ],
  },
  moves: {
    key: 'move_id',
    headers: [
      'username', 'condition', 'puzzle_id', 'puzzle_order', 'player_color',
      'start_fen', 'start_eval_cp', 'start_eval_mate', 'start_best_move_san',
      'start_best_move_uci', 'start_stockfish_best_move_uci', 'move_number',
      'fen_before_move', 'eval_before_move_cp', 'eval_before_move_mate',
      'player_move_san', 'player_move_uci', 'time_ms', 'fen_after_move',
      'eval_after_move_cp', 'eval_after_move_mate', 'stockfish_reply_san',
      'stockfish_reply_uci', 'fen_after_stockfish', 'eval_after_stockfish_cp',
      'eval_after_stockfish_mate', 'move_id', 'session_id', 'experiment_version',
      'schema_version', 'puzzle_status', 'puzzle_started_remaining_ms',
      'move_started_remaining_ms', 'move_ended_remaining_ms',
      'cumulative_decision_time_ms', 'eval_before_move_participant_cp',
      'eval_after_move_participant_cp', 'eval_after_stockfish_participant_cp',
      'terminal_outcome_after_player', 'terminal_outcome_after_stockfish',
    ],
  },
};

function doGet() {
  return out({ ok: true, service: 'chess-signal-experiment', schemaVersion: 2 });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return out({ ok: false, error: 'bad secret' });

    if (data.action === 'checkUsername') return handleCheckUsername_(data);
    if (data.action === 'claimUsername') return handleClaimUsername_(data);
    if (data.action === 'appendRecords') return handleAppendRecords_(data);
    if (data.action === 'backfillUsedUsernames') return handleBackfillUsedUsernames_();
    return out({ ok: false, error: 'unsupported action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function handleCheckUsername_(data) {
  const username = normalizeUsername_(data.username);
  if (!username) return out({ ok: false, error: 'missing username' });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const assignment = findUsernameAssignment_(ss, username);
  if (!assignment) return out({ ok: false, code: 'unknown_username', error: 'unknown username' });
  const used = findUsernameUse_(ss, username);
  return out({
    ok: true,
    username,
    condition: assignment.condition,
    available: !used,
    usedAt: used ? used.claimedAt : '',
    source: used ? used.source : '',
  });
}

function handleClaimUsername_(data) {
  const username = normalizeUsername_(data.username);
  const condition = String(data.condition || '').toLowerCase();
  const sessionId = String(data.sessionId || '').trim();
  if (!username || !sessionId) return out({ ok: false, error: 'missing username or sessionId' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const assignment = findUsernameAssignment_(ss, username);
    if (!assignment || assignment.condition !== condition) {
      return out({ ok: false, code: 'unknown_username', error: 'username assignment mismatch' });
    }

    const used = findUsernameUse_(ss, username);
    if (used) {
      if (used.sessionId && used.sessionId === sessionId) {
        return out({
          ok: true,
          username,
          condition,
          sessionId,
          resumed: true,
          completed: used.status === 'completed',
        });
      }
      return out({
        ok: false,
        code: 'username_used',
        error: 'username already used',
        usedAt: used.claimedAt,
        source: used.source,
      });
    }

    const sheet = ensureUsedUsernamesSheet_(ss);
    sheet.appendRow([
      username, condition, new Date().toISOString(), 'login_claim',
      sessionId, 'claimed', '',
    ]);
    return out({ ok: true, username, condition, sessionId, resumed: false });
  } finally {
    lock.releaseLock();
  }
}

function handleAppendRecords_(data) {
  const dataset = String(data.dataset || '');
  const schema = DATASET_SCHEMAS[dataset];
  const records = Array.isArray(data.records) ? data.records : [];
  if (!schema) return out({ ok: false, error: 'unsupported dataset' });
  if (!records.length) return out({ ok: true, dataset, appended: 0, skippedExisting: 0 });
  if (records.length > 100) return out({ ok: false, error: 'too many records' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const identity = validateRecordIdentity_(ss, records);
    if (!identity.ok) return out(identity);

    let completionReceipt = {};
    if (dataset === 'sessions') {
      const verification = verifySessionCompleteness_(ss, identity, records[0]);
      if (!verification.ok) return out(verification);
      completionReceipt = {
        verifiedPuzzleRecords: verification.verifiedPuzzleRecords,
        verifiedMoveRecords: verification.verifiedMoveRecords,
      };
    }

    const result = appendUniqueRecords_(ss, dataset, schema, records);
    if (dataset === 'sessions') {
      markUsernameCompleted_(ss, identity.username, identity.sessionId);
    }
    return out({ ok: true, dataset, ...result, ...completionReceipt });
  } finally {
    lock.releaseLock();
  }
}

function validateRecordIdentity_(ss, records) {
  const first = records[0] || {};
  const username = normalizeUsername_(first.username);
  const condition = String(first.condition || '').toLowerCase();
  const sessionId = String(first.session_id || '').trim();
  if (!username || !condition || !sessionId) {
    return { ok: false, error: 'record identity is incomplete' };
  }
  if (records.some(record =>
    normalizeUsername_(record.username) !== username ||
    String(record.condition || '').toLowerCase() !== condition ||
    String(record.session_id || '').trim() !== sessionId
  )) {
    return { ok: false, error: 'mixed record identities' };
  }

  const assignment = findUsernameAssignment_(ss, username);
  if (!assignment || assignment.condition !== condition) {
    return { ok: false, code: 'unknown_username', error: 'username assignment mismatch' };
  }
  const used = findUsernameUse_(ss, username);
  if (!used || used.sessionId !== sessionId) {
    return { ok: false, code: 'username_used', error: 'session does not own username claim' };
  }
  return { ok: true, username, condition, sessionId };
}

function appendUniqueRecords_(ss, dataset, schema, records) {
  const sheet = ensureDatasetSheet_(ss, dataset, schema.headers);
  const keyIndex = schema.headers.indexOf(schema.key);
  const existing = new Set();
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, keyIndex + 1, sheet.getLastRow() - 1, 1)
      .getValues()
      .forEach(row => existing.add(String(row[0] || '')));
  }

  const seenIncoming = new Set();
  const rows = [];
  records.forEach(record => {
    const key = String(record[schema.key] || '');
    if (!key) throw new Error(`missing ${schema.key}`);
    if (existing.has(key) || seenIncoming.has(key)) return;
    seenIncoming.add(key);
    rows.push(schema.headers.map(header =>
      record[header] === null || record[header] === undefined ? '' : record[header]
    ));
  });

  if (rows.length) {
    const startRow = sheet.getLastRow() + 1;
    ensureRowCapacity_(sheet, startRow + rows.length - 1);
    sheet.getRange(startRow, 1, rows.length, schema.headers.length).setValues(rows);
  }
  return { appended: rows.length, skippedExisting: records.length - rows.length };
}

function ensureRowCapacity_(sheet, requiredLastRow) {
  const maxRows = sheet.getMaxRows();
  if (requiredLastRow <= maxRows) return;
  const missingRows = requiredLastRow - maxRows;
  sheet.insertRowsAfter(maxRows, Math.max(1000, missingRows));
}

function verifySessionCompleteness_(ss, identity, sessionRecord) {
  const expectedVersion = String(sessionRecord.experiment_version || '');
  const expectedSchema = String(sessionRecord.schema_version || '');
  const puzzleData = rowsForSession_(ss, 'puzzles', identity.sessionId);
  const moveData = rowsForSession_(ss, 'moves', identity.sessionId);

  if (!puzzleData.ok || !moveData.ok) {
    return {
      ok: false,
      code: 'incomplete_session',
      error: 'required response tables are unavailable',
    };
  }

  const puzzles = puzzleData.rows;
  if (puzzles.length !== 6) {
    return {
      ok: false,
      code: 'incomplete_session',
      error: `expected 6 puzzle records, found ${puzzles.length}`,
    };
  }

  const puzzleIds = new Set();
  const expectedMovesByPuzzle = {};
  for (let i = 0; i < puzzles.length; i += 1) {
    const row = puzzles[i];
    const puzzleId = String(rowValue_(puzzleData, row, 'puzzle_id'));
    const movesCompleted = Number(rowValue_(puzzleData, row, 'moves_completed'));
    if (!puzzleId || puzzleIds.has(puzzleId) || !Number.isInteger(movesCompleted) || movesCompleted < 0 || movesCompleted > 5) {
      return { ok: false, code: 'incomplete_session', error: 'invalid puzzle record set' };
    }
    if (!rowMatchesIdentity_(puzzleData, row, identity, expectedVersion, expectedSchema)) {
      return { ok: false, code: 'incomplete_session', error: 'puzzle record identity mismatch' };
    }
    puzzleIds.add(puzzleId);
    expectedMovesByPuzzle[puzzleId] = movesCompleted;
  }

  const requiredPuzzleIds = ['1', '2', '3', '4', '5', '6'];
  if (requiredPuzzleIds.some(id => !puzzleIds.has(id))) {
    return { ok: false, code: 'incomplete_session', error: 'puzzle record set is incomplete' };
  }

  const moves = moveData.rows;
  const moveIds = new Set();
  const actualMovesByPuzzle = {};
  for (let i = 0; i < moves.length; i += 1) {
    const row = moves[i];
    const puzzleId = String(rowValue_(moveData, row, 'puzzle_id'));
    const moveId = String(rowValue_(moveData, row, 'move_id'));
    if (!puzzleIds.has(puzzleId) || !moveId || moveIds.has(moveId)) {
      return { ok: false, code: 'incomplete_session', error: 'invalid move record set' };
    }
    if (!rowMatchesIdentity_(moveData, row, identity, expectedVersion, expectedSchema)) {
      return { ok: false, code: 'incomplete_session', error: 'move record identity mismatch' };
    }
    moveIds.add(moveId);
    actualMovesByPuzzle[puzzleId] = (actualMovesByPuzzle[puzzleId] || 0) + 1;
  }

  for (let i = 0; i < requiredPuzzleIds.length; i += 1) {
    const puzzleId = requiredPuzzleIds[i];
    if ((actualMovesByPuzzle[puzzleId] || 0) !== expectedMovesByPuzzle[puzzleId]) {
      return {
        ok: false,
        code: 'incomplete_session',
        error: `move records do not reconcile for puzzle ${puzzleId}`,
      };
    }
  }

  const declaredCompleted = Number(sessionRecord.puzzles_completed_before_timeout || 0);
  const declaredTimedOut = Number(sessionRecord.puzzles_timed_out_or_unstarted || 0);
  if (declaredCompleted + declaredTimedOut !== 6) {
    return { ok: false, code: 'incomplete_session', error: 'session puzzle totals do not reconcile' };
  }

  return {
    ok: true,
    verifiedPuzzleRecords: puzzles.length,
    verifiedMoveRecords: moves.length,
  };
}

function rowsForSession_(ss, sheetName, sessionId) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 1) return { ok: false, headers: [], index: {}, rows: [] };
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = {};
  headers.forEach((header, position) => { index[header] = position; });
  if (index.session_id === undefined) return { ok: false, headers, index, rows: [] };
  const values = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  return {
    ok: true,
    headers,
    index,
    rows: values.filter(row => String(row[index.session_id] || '') === sessionId),
  };
}

function rowValue_(data, row, header) {
  return data.index[header] === undefined ? '' : row[data.index[header]];
}

function rowMatchesIdentity_(data, row, identity, experimentVersion, schemaVersion) {
  return normalizeUsername_(rowValue_(data, row, 'username')) === identity.username &&
    String(rowValue_(data, row, 'condition')).toLowerCase() === identity.condition &&
    String(rowValue_(data, row, 'experiment_version')) === experimentVersion &&
    String(rowValue_(data, row, 'schema_version')) === schemaVersion;
}

function ensureDatasetSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name, ss.getNumSheets(), { rows: 1000, columns: headers.length });
    sheet.setFrozenRows(1);
  }
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(String);
  if (actual.join('\u001f') !== headers.join('\u001f')) {
    throw new Error(`schema mismatch in ${name}`);
  }
  return sheet;
}

function findUsernameAssignment_(ss, username) {
  const sheet = ss.getSheetByName(USERNAMES_TAB);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (normalizeUsername_(values[i][0]) === username) {
      return { condition: String(values[i][1] || '').toLowerCase() };
    }
  }
  return null;
}

function findUsernameUse_(ss, username) {
  const sheet = ss.getSheetByName(USED_USERNAMES_TAB);
  if (sheet && sheet.getLastRow() >= 2) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, USED_USERNAMES_HEADER.length).getValues();
    for (let i = 0; i < values.length; i += 1) {
      if (normalizeUsername_(values[i][0]) === username) {
        return {
          row: i + 2,
          condition: String(values[i][1] || ''),
          claimedAt: String(values[i][2] || ''),
          source: String(values[i][3] || USED_USERNAMES_TAB),
          sessionId: String(values[i][4] || ''),
          status: String(values[i][5] || 'completed'),
          completedAt: String(values[i][6] || ''),
        };
      }
    }
  }

  const sessions = ss.getSheetByName('sessions');
  if (!sessions || sessions.getLastRow() < 2) return null;
  const headers = sessions.getRange(1, 1, 1, sessions.getLastColumn()).getValues()[0].map(String);
  const usernameIndex = headers.indexOf('username');
  const sessionIndex = headers.indexOf('session_id');
  if (usernameIndex < 0) return null;
  const values = sessions.getRange(2, 1, sessions.getLastRow() - 1, sessions.getLastColumn()).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (normalizeUsername_(values[i][usernameIndex]) === username) {
      return {
        row: null,
        condition: '',
        claimedAt: '',
        source: 'sessions',
        sessionId: sessionIndex >= 0 ? String(values[i][sessionIndex] || '') : '',
        status: 'completed',
        completedAt: '',
      };
    }
  }
  return null;
}

function markUsernameCompleted_(ss, username, sessionId) {
  const used = findUsernameUse_(ss, username);
  if (!used || used.sessionId !== sessionId || !used.row) return;
  const sheet = ensureUsedUsernamesSheet_(ss);
  sheet.getRange(used.row, 6, 1, 2).setValues([['completed', new Date().toISOString()]]);
}

function handleBackfillUsedUsernames_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureUsedUsernamesSheet_(ss);
  return out({ ok: true, appended: 0 });
}

// Run once from the Apps Script editor when upgrading the original workbook.
// It preserves legacy test rows, labels their protocol version, and installs
// the canonical v2 schemas. The function is idempotent.
function migrateToSchemaV2() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    migrateSessions_(ss);
    migrateMoves_(ss);
    migrateUsedUsernames_(ss);
    ensureDatasetSheet_(ss, 'puzzles', DATASET_SCHEMAS.puzzles.headers);
    return { ok: true, schemaVersion: 2 };
  } finally {
    lock.releaseLock();
  }
}

// Run from the Apps Script editor before launch if preallocated capacity is
// preferred. Normal writes also expand each response tab automatically.
function ensureProductionCapacity() {
  const minimumRows = {
    used_usernames: 1000,
    sessions: 1000,
    puzzles: 1000,
    moves: 5000,
  };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const result = {};
    Object.keys(minimumRows).forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) throw new Error(`missing response tab ${name}`);
      ensureRowCapacity_(sheet, minimumRows[name]);
      result[name] = sheet.getMaxRows();
    });
    return { ok: true, rows: result };
  } finally {
    lock.releaseLock();
  }
}

function migrateSessions_(ss) {
  const sheet = ss.getSheetByName('sessions');
  if (!sheet) {
    ensureDatasetSheet_(ss, 'sessions', DATASET_SCHEMAS.sessions.headers);
    return;
  }
  const target = DATASET_SCHEMAS.sessions.headers;
  const current = sheet.getLastRow()
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : [];
  if (current.slice(0, target.length).join('\u001f') === target.join('\u001f')) return;

  const values = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  const index = {};
  current.forEach((header, position) => { index[header] = position; });
  const get = (row, header) => index[header] === undefined ? '' : row[index[header]];
  const migrated = values.filter(row => get(row, 'username')).map(row => {
    const username = normalizeUsername_(get(row, 'username'));
    const startedAt = String(get(row, 'started_at') || 'legacy');
    const sessionId = `legacy-${username}-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;
    const noOutsideHelp = String(get(row, 'survey_q5') || '').toLowerCase();
    const outsideHelpUsed = noOutsideHelp === 'yes' ? 'no' : (noOutsideHelp === 'no' ? 'yes' : '');
    return [
      username, get(row, 'condition'), sessionId, 'legacy-pre-total-budget', 1,
      startedAt, get(row, 'puzzles_completed_at'), get(row, 'survey_submitted_at'),
      'completed', '', '', '', 6, 0, get(row, 'puzzle_order_played'),
      get(row, 'survey_q1'), get(row, 'survey_q2'), get(row, 'survey_q3'),
      get(row, 'survey_q4'), '', outsideHelpUsed, get(row, 'survey_q6'),
      outsideHelpUsed === 'yes', outsideHelpUsed === 'yes' ? 'reported_outside_help' : '',
    ];
  });
  if (sheet.getMaxColumns() < target.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), target.length - sheet.getMaxColumns());
  }
  sheet.clearContents();
  sheet.getRange(1, 1, 1, target.length).setValues([target]);
  if (migrated.length) sheet.getRange(2, 1, migrated.length, target.length).setValues(migrated);
  sheet.setFrozenRows(1);
}

function migrateMoves_(ss) {
  const sheet = ss.getSheetByName('moves');
  if (!sheet) {
    ensureDatasetSheet_(ss, 'moves', DATASET_SCHEMAS.moves.headers);
    return;
  }
  const target = DATASET_SCHEMAS.moves.headers;
  if (sheet.getMaxColumns() < target.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), target.length - sheet.getMaxColumns());
  }
  const current = sheet.getLastRow()
    ? sheet.getRange(1, 1, 1, target.length).getValues()[0].map(String)
    : [];
  if (current.join('\u001f') !== target.join('\u001f')) {
    const legacy = target.slice(0, 26);
    if (current.slice(0, 26).join('\u001f') !== legacy.join('\u001f')) {
      throw new Error('unrecognized legacy moves schema');
    }
    sheet.getRange(1, 1, 1, target.length).setValues([target]);
  }
  sheet.setFrozenRows(1);
}

function migrateUsedUsernames_(ss) {
  let sheet = ss.getSheetByName(USED_USERNAMES_TAB);
  if (!sheet) {
    ensureUsedUsernamesSheet_(ss);
    return;
  }
  const current = sheet.getLastRow()
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : [];
  if (current.slice(0, USED_USERNAMES_HEADER.length).join('\u001f') === USED_USERNAMES_HEADER.join('\u001f')) return;
  const legacyRows = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  const sessions = ss.getSheetByName('sessions');
  const sessionValues = sessions && sessions.getLastRow() >= 2
    ? sessions.getRange(2, 1, sessions.getLastRow() - 1, 3).getValues()
    : [];
  const sessionByUsername = {};
  sessionValues.forEach(row => { sessionByUsername[normalizeUsername_(row[0])] = String(row[2] || ''); });
  const migrated = legacyRows.filter(row => row[0]).map(row => [
    normalizeUsername_(row[0]), row[1], row[2], row[3] || 'sessions_legacy',
    sessionByUsername[normalizeUsername_(row[0])] || '', 'completed', row[2],
  ]);
  if (sheet.getMaxColumns() < USED_USERNAMES_HEADER.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), USED_USERNAMES_HEADER.length - sheet.getMaxColumns());
  }
  sheet.clearContents();
  sheet.getRange(1, 1, 1, USED_USERNAMES_HEADER.length).setValues([USED_USERNAMES_HEADER]);
  if (migrated.length) sheet.getRange(2, 1, migrated.length, USED_USERNAMES_HEADER.length).setValues(migrated);
  sheet.setFrozenRows(1);
}

function ensureUsedUsernamesSheet_(ss) {
  let sheet = ss.getSheetByName(USED_USERNAMES_TAB);
  if (!sheet) sheet = ss.insertSheet(USED_USERNAMES_TAB);
  if (sheet.getMaxColumns() < USED_USERNAMES_HEADER.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), USED_USERNAMES_HEADER.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, USED_USERNAMES_HEADER.length).setValues([USED_USERNAMES_HEADER]);
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
