'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const index = read('index.html');
const app = read('js/app.js');
const sync = read('js/sync.js');
const appsScript = read('apps-script/Code.js');

assert(index.indexOf('js/config.js') < index.indexOf('js/sync.js'), 'login page must load config before sync');
assert(index.indexOf('js/sync.js') < index.indexOf('js/app.js'), 'login page must load sync before app');

assert(sync.includes('async function checkUsername'), 'Sync must expose a username availability check');
assert(sync.includes("action: 'checkUsername'"), 'username check must call the server action');
assert(sync.includes('checkUsername'), 'Sync return object must expose checkUsername');

assert(app.includes('Sync.checkUsername'), 'login must check server username availability before redirect');
assert(app.includes('already been used'), 'login must show a clear already-used message');

assert(appsScript.includes("USED_USERNAMES_TAB = 'used_usernames'"), 'Apps Script must define a used_usernames tab');
assert(appsScript.includes('LockService.getScriptLock'), 'session submit must use a script lock');
assert(appsScript.includes("code: 'username_used'"), 'duplicate final submissions must return username_used');
assert(appsScript.includes("action === 'checkUsername'"), 'Apps Script must handle checkUsername action');
assert(appsScript.includes("action === 'backfillUsedUsernames'"), 'Apps Script must support backfilling existing sessions');

console.log('username lock contract ok');
