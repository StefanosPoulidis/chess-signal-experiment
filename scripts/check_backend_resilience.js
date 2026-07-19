#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        (this.sheet.rows[this.row - 1 + rowOffset] || [])[this.column - 1 + columnOffset] ?? ''
      )
    );
  }

  setValues(values) {
    if (this.row + values.length - 1 > this.sheet.maxRows) throw new Error('row out of bounds');
    values.forEach((valuesRow, rowOffset) => {
      const targetRow = this.row - 1 + rowOffset;
      if (!this.sheet.rows[targetRow]) this.sheet.rows[targetRow] = [];
      valuesRow.forEach((value, columnOffset) => {
        this.sheet.rows[targetRow][this.column - 1 + columnOffset] = value;
      });
    });
  }
}

class FakeSheet {
  constructor(rows, maxRows = 1000) {
    this.rows = rows.map(row => [...row]);
    this.maxRows = maxRows;
  }

  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0] ? this.rows[0].length : 0; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.getLastColumn(); }
  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }
  insertRowsAfter(_after, count) { this.maxRows += count; }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(name) { return this.sheets[name] || null; }
}

const source = fs.readFileSync('apps-script/Code.js', 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.TEST_API = {
  appendUniqueRecords_, verifySessionCompleteness_
};`, sandbox);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const capacitySheet = new FakeSheet([['id', 'value']], 2);
const capacitySs = new FakeSpreadsheet({ test: capacitySheet });
const appendResult = sandbox.TEST_API.appendUniqueRecords_(
  capacitySs,
  'test',
  { key: 'id', headers: ['id', 'value'] },
  [
    { id: 'one', value: 1 },
    { id: 'two', value: 2 },
    { id: 'three', value: 3 },
  ]
);
assert(appendResult.appended === 3, 'all records must append');
assert(capacitySheet.maxRows >= 4, 'sheet must grow before writing beyond its row limit');
const duplicateResult = sandbox.TEST_API.appendUniqueRecords_(
  capacitySs,
  'test',
  { key: 'id', headers: ['id', 'value'] },
  [{ id: 'one', value: 999 }]
);
assert(duplicateResult.appended === 0 && duplicateResult.skippedExisting === 1, 'retries must be idempotent');

const puzzleHeaders = [
  'session_id', 'username', 'condition', 'experiment_version', 'schema_version',
  'puzzle_id', 'moves_completed',
];
const moveHeaders = [
  'session_id', 'username', 'condition', 'experiment_version', 'schema_version',
  'puzzle_id', 'move_id',
];
const identity = { username: 'test-user', condition: 'att', sessionId: 'session-1' };
const version = 'test-version';
const puzzleRows = [puzzleHeaders];
const moveRows = [moveHeaders];
for (let puzzleId = 1; puzzleId <= 6; puzzleId += 1) {
  puzzleRows.push(['session-1', 'test-user', 'att', version, 2, puzzleId, 1]);
  moveRows.push(['session-1', 'test-user', 'att', version, 2, puzzleId, `move-${puzzleId}`]);
}
const sessionRecord = {
  experiment_version: version,
  schema_version: 2,
  puzzles_completed_before_timeout: 6,
  puzzles_timed_out_or_unstarted: 0,
};
const completeSs = new FakeSpreadsheet({
  puzzles: new FakeSheet(puzzleRows),
  moves: new FakeSheet(moveRows),
});
const complete = sandbox.TEST_API.verifySessionCompleteness_(completeSs, identity, sessionRecord);
assert(complete.ok, 'complete puzzle and move sets must receive a completion receipt');
assert(complete.verifiedPuzzleRecords === 6 && complete.verifiedMoveRecords === 6, 'receipt counts must be exact');

const incompleteSs = new FakeSpreadsheet({
  puzzles: new FakeSheet(puzzleRows),
  moves: new FakeSheet(moveRows.slice(0, -1)),
});
const incomplete = sandbox.TEST_API.verifySessionCompleteness_(incompleteSs, identity, sessionRecord);
assert(!incomplete.ok && incomplete.code === 'incomplete_session', 'missing moves must block completion');

console.log('backend capacity and completion-receipt contract ok');
