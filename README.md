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

## Username DB

Run `python3 scripts/generate_usernames.py` to regenerate 200 usernames
(100 `att`, 100 `act`). Outputs:

- `js/usernames.js` — SHA-256 hash → condition (committed, public-safe).
- `private/usernames_cleartext.csv` — cleartext list for offline distribution (gitignored).

Seeded with a fixed seed, so regeneration is deterministic.
