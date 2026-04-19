# Chess Signal Experiment

Interactive web platform for a between-participants experiment testing
**attention (`att`)** vs **action (`act`)** signals on 6 chess puzzles.

## How it works

- Participants log in with a pre-assigned username.
- Each username is mapped (hashed, public-safe) to a treatment condition: `att` or `act`.
- Participants play 6 puzzles in randomized order. Stockfish plays the opponent.
- On the starting position of each puzzle, a signal is shown per condition:
  - `att` — banner: *"There is a unique optimal move here!"*
  - `act` — banner: *"Best move: <SAN>"* + arrow drawn on the board
- Signal is shown **only on the starting position** (first player move); from move 2 on, the board is clean.
- Per-move logging: player's move, time spent, Stockfish reply, Stockfish eval before/after.
- At session end, data can be downloaded as JSON/CSV.

## Architecture

- Static site, hosted on GitHub Pages.
- [`chess.js`](https://github.com/jhlywa/chess.js) for move validation.
- [`chessboard2`](https://github.com/oakmac/chessboard2) for the UI.
- [`stockfish.js`](https://github.com/nmrugg/stockfish.js) (asm.js / WASM) running as a Web Worker.
- No backend. Session data → `localStorage` + download.

## Status

- **Phase 1** ✅ — repo scaffold, username DB, login, GH Pages deploy.
- **Phase 2** 🚧 — chess board, Stockfish integration, game flow, data logging.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Data storage (Google Sheets via Apps Script)

Per-puzzle moves and the final session + survey row are POSTed to a Google
Apps Script Web App that appends to a Google Sheet you own.

**One-time setup:**

1. Create a new Google Sheet. Add two tabs named exactly `moves` and `sessions`.
2. In that Sheet: `Extensions → Apps Script`. Paste this code and save:

   ```javascript
   const SECRET = 'CHANGE-ME-to-a-random-string';

   function doPost(e) {
     try {
       const data = JSON.parse(e.postData.contents);
       if (data.secret !== SECRET) return out({ ok: false, error: 'bad secret' });
       const ss = SpreadsheetApp.getActiveSpreadsheet();
       const sheet = ss.getSheetByName(data.tab);
       if (!sheet) return out({ ok: false, error: 'no tab ' + data.tab });
       if (sheet.getLastRow() === 0 && data.headers) sheet.appendRow(data.headers);
       for (const row of (data.rows || [])) sheet.appendRow(row);
       return out({ ok: true, appended: (data.rows || []).length });
     } catch (err) {
       return out({ ok: false, error: String(err) });
     }
   }
   function out(obj) {
     return ContentService.createTextOutput(JSON.stringify(obj))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

3. Change `SECRET` to any random string.
4. `Deploy → New deployment → Type: Web app`, Execute as **Me**, Who has access
   **Anyone**. Authorize the prompts. Copy the Web app URL.
5. Edit `js/config.js` in this repo: paste the URL into `webAppUrl` and the
   secret string into `secret`. Commit + push.

## Username DB

Run `python3 scripts/generate_usernames.py` to regenerate 200 usernames
(100 `att`, 100 `act`). Outputs:

- `js/usernames.js` — SHA-256 hash → condition (committed, public-safe).
- `private/usernames_cleartext.csv` — cleartext list for offline distribution (gitignored).

Seeded with a fixed seed, so regeneration is deterministic.
