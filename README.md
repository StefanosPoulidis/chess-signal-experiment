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
- Participants share a six-minute active decision-time budget across all six puzzles. The clock pauses during Stockfish computation and puzzle transitions.
- The clock and in-progress puzzle state persist across refreshes. At expiration, the current and remaining puzzles receive explicit timeout records.
- Data include participant-puzzle outcomes, per-move timing and evaluations, total remaining time, terminal outcomes, timeout status, and the final survey.

## Architecture

- Static site, hosted on GitHub Pages.
- [`chess.js`](https://github.com/jhlywa/chess.js) for move validation.
- [`chessboard2`](https://github.com/oakmac/chessboard2) for the UI.
- [`stockfish.js`](https://github.com/nmrugg/stockfish.js) (asm.js / WASM) running as a Web Worker.
- Session state is retained in `localStorage`; idempotent records are sent to Google Sheets through a Google Apps Script Web App.

## Study protocol implemented by the platform

- Treatment assignment is external. Each pre-assigned username maps to `att` or `act`.
- Puzzle order is randomized in the browser and retained for the full session.
- The shared clock runs only while the participant can legally decide on a move.
- Each puzzle ends after five participant moves, a terminal chess position, or expiration of the shared budget.
- Evaluations are stored from White's perspective and from the participant's perspective.
- `Yes` to the direct outside-help question sets `data_quality_exclude=true` and `data_quality_reason=reported_outside_help`.
- The current protocol/data version is `2026-07-19-total-budget-v1` with schema version `2`.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Local smoke modes use deterministic puzzle order and never write to the
production spreadsheet:

- `http://localhost:8000/?smoke=timeout` uses an eight-second budget.
- `http://localhost:8000/?smoke=move` uses the full six-minute budget.

## Data storage (Google Sheets via Apps Script)

Participant-puzzle records, moves, and the final session/survey row are POSTed
to a Google Apps Script Web App. Stable record IDs make retries idempotent.

**One-time setup:**

1. Create a `Usernames` tab containing the username and condition assignments.
2. In the Sheet, open `Extensions → Apps Script`, paste `apps-script/Code.js`, save, and run `migrateToSchemaV2` once. The migration preserves recognized legacy rows and creates or upgrades the response tabs.
3. Set `SECRET` and `SPREADSHEET_ID` at the top of the script.
4. `Deploy → New deployment → Type: Web app`, Execute as **Me**, Who has access
   **Anyone**. Authorize the prompts. Copy the Web app URL.
5. Edit `js/config.js` in this repo: paste the URL into `webAppUrl` and the
   secret string into `secret`. Commit + push.

The server atomically claims a username at login. Data writes must carry the
same session ID that owns that claim, and duplicate move/puzzle/session IDs are
ignored rather than appended again.

## Username DB

Run `python3 scripts/generate_usernames.py` to maintain the private username
pool and regenerate the public hash allowlist. The current target is 160
recognized usernames per condition, with a private assignment export of 150
currently usable usernames per condition.

- `js/usernames.js` — SHA-256 hash → condition (committed, public-safe).
- `private/usernames_cleartext.csv` — all cleartext recognized usernames (gitignored).
- `private/available_usernames_for_assignment.csv` — exactly 150 assignable
  usernames per condition, excluding names in `private/used_usernames_snapshot.txt`
  (gitignored).
- `private/available_usernames_att.txt` and `private/available_usernames_act.txt`
  — condition-specific assignment lists (gitignored).

The script preserves existing private per-condition lists and appends deterministic
new names, so old assignments do not change.

## Resetting a Username

Do not reset a real participant username unless that session should be excluded.
To reuse a test username, remove that username's rows from all four response tabs:

- `used_usernames`
- `sessions`
- `puzzles`
- `moves`

Deleting only the `used_usernames` row is not enough, because the live app also
checks `sessions` before allowing reuse.
