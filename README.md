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
- Each puzzle has its own 75-second active decision-time countdown. The clock pauses during Stockfish computation and puzzle transitions, and unused time never carries over.
- The clock and in-progress puzzle state persist across refreshes. At expiration, only the current puzzle receives a timeout record; the next puzzle starts with a fresh 75 seconds.
- Data include participant-puzzle outcomes, per-move timing, CP evaluations,
  win percentages/probabilities, move accuracy, per-puzzle remaining time,
  terminal outcomes, timeout status, and the final survey.

## Architecture

- Static site, hosted on GitHub Pages.
- [`chess.js`](https://github.com/jhlywa/chess.js) 0.10.3 for move validation.
- [`chessboard.js`](https://github.com/oakmac/chessboardjs) 1.0.0 and jQuery
  3.7.1 for the board UI. Their runtime assets and the v1.0.0 Wikipedia piece
  set are pinned and self-hosted under `vendor/`; the piece set is taken from
  chessboard.js commit `bfa31a05da24e6c3877f7acfa12dfa77ad7638bf`.
- Stockfish 18 via [`stockfish.js`](https://github.com/nmrugg/stockfish.js),
  pinned at npm package `18.0.8` and self-hosted as the lite single-threaded
  WebAssembly build. Live analyses use depth 20.
- Session state is retained in `localStorage`; idempotent records are sent to Google Sheets through a Google Apps Script Web App.

## Study protocol implemented by the platform

- Treatment assignment is external. Each pre-assigned username maps to `att` or `act`.
- Puzzle order is randomized in the browser and retained for the full session.
- Each independent countdown runs only while the participant can legally decide on a move.
- Each puzzle ends after five participant moves, a terminal chess position, or expiration of its own 75-second limit. A timeout does not prevent the participant from attempting the remaining puzzles.
- Evaluations are stored from White's perspective and from the participant's perspective.
- At the start, before and after every participant move, after every Stockfish
  reply, and at the final position, the platform stores CP, win percentage
  (0-100), and win probability (0-1). Checkmate and draws are mapped exactly to
  100/0 and 50 percent, then transformed to the participant's perspective.
- Win percentage follows Appendix C.2 of the June 2025 paper:
  `W(cp) = 100 / (1 + exp(-0.00368208 * cp))`.
- Participant move accuracy uses the same appendix:
  `103.1668 * exp(-0.04354 * (W_before - W_after)) - 3.1669`.
  `W_after` is measured immediately after the participant's move and before
  the opponent reply. Raw values are retained; values outside 0-100 are marked
  invalid and left blank in the analysis-ready accuracy field, as in the paper.
- Timeout remains a separate outcome and is never recoded as a loss. The final
  position reached before timeout still receives descriptive position metrics.
- `Yes` to the direct outside-help question sets `data_quality_exclude=true` and `data_quality_reason=reported_outside_help`.
- The current protocol/data version is
  `2026-08-01-stockfish18-paper-scoring-v2` with schema version `3`.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Local smoke modes use deterministic puzzle order and never write to the
production spreadsheet:

- `http://localhost:8000/?smoke=timeout` uses eight seconds per puzzle.
- `http://localhost:8000/?smoke=move` uses the production 75 seconds per puzzle.

## Data storage (Google Sheets via Apps Script)

Participant-puzzle records, moves, and the final session/survey row are POSTed
to a Google Apps Script Web App. Stable record IDs make retries idempotent.
The legacy session-level budget fields now report the aggregate of the six
independent allocations; they do not indicate that participants can transfer
unused time between puzzles. Per-puzzle start/end balances remain canonical.

**One-time setup:**

1. Create a `Usernames` tab containing the username and condition assignments.
2. In the Sheet, open `Extensions -> Apps Script`, paste
   `apps-script/Code.js`, save, and run `migrateToSchemaV3` once. The migration
   preserves all existing rows and columns and appends the engine/scoring fields.
   Normal authenticated data writes also perform the same prefix-safe extension,
   so a delayed manual migration cannot cause response loss.
3. Set `SECRET` and `SPREADSHEET_ID` at the top of the script.
4. `Deploy → New deployment → Type: Web app`, Execute as **Me**, Who has access
   **Anyone**. Authorize the prompts. Copy the Web app URL.
5. Edit `js/config.js` in this repo: paste the URL into `webAppUrl` and the
   secret string into `secret`. Commit + push.

The server atomically claims a username at login. Data writes must carry the
same session ID that owns that claim, and duplicate move/puzzle/session IDs are
ignored rather than appended again. Response tabs expand automatically as the
sample grows. A final session row is accepted, and the username marked complete,
only after the server verifies all six puzzle records and reconciles the saved
move rows against each puzzle's recorded move count.

`ensureProductionCapacity()` may be run once from the Apps Script editor to
preallocate 5,000 move rows. This is optional because normal writes also expand
the response tabs automatically before reaching their row limits.

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
