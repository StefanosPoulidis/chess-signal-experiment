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

assert(sync.includes('function claimUsername'), 'Sync must expose an atomic username claim');
assert(sync.includes("action: 'claimUsername'"), 'username claim must call the server action');
assert(sync.includes('claimUsername'), 'Sync return object must expose claimUsername');

assert(app.includes('Sync.claimUsername'), 'login must claim the username before redirect');
assert(app.includes('already been used'), 'login must show a clear already-used message');
assert(app.includes('function recoverLocalSession'), 'login must recover an unfinished local session');
assert(app.includes("localStorage.getItem('chess-signal-session')"), 'resume must use the persisted experiment session');
assert(app.includes('resumableParticipant.sessionId'), 'resume must reclaim the original server session id');
assert(app.includes('!saved.surveySubmittedAt'), 'an unsubmitted post-study survey must remain resumable');
assert(!app.includes("saved.taskStatus !== 'completed'"), 'finishing the chess task must not block survey recovery');

assert(appsScript.includes("USED_USERNAMES_TAB = 'used_usernames'"), 'Apps Script must define a used_usernames tab');
assert(appsScript.includes('LockService.getScriptLock'), 'username claim and data append must use a script lock');
assert(appsScript.includes("code: 'username_used'"), 'duplicate final submissions must return username_used');
assert(appsScript.includes('used.sessionId === sessionId'), 'the owning session must be resumable after an ambiguous final response');
assert(appsScript.includes("completed: used.status === 'completed'"), 'resume response must report server completion status');
assert(appsScript.includes("data.action === 'checkUsername'"), 'Apps Script must handle checkUsername action');
assert(appsScript.includes("data.action === 'claimUsername'"), 'Apps Script must handle claimUsername action');
assert(appsScript.includes("data.action === 'backfillUsedUsernames'"), 'Apps Script must support backfilling existing sessions');
assert(appsScript.includes('session does not own username claim'), 'data writes must belong to the claimed session');

console.log('username lock contract ok');
