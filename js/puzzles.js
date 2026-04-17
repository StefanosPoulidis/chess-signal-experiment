// PLACEHOLDER FENs — replace with the real 6 positions once finalized.
// Side-to-move in each FEN must match the player's color (player moves first).
// The `perfectPlay` value is the expected Stockfish eval of the correct move (white's POV),
// used only for offline analysis/validation. Live eval comes from the in-browser engine.

window.PUZZLES = [
  {
    id: 1,
    playerColor: 'white',
    perfectPlay:  5.8,
    startFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  },
  {
    id: 2,
    playerColor: 'black',
    perfectPlay: -2.9,
    startFen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4',
  },
  {
    id: 3,
    playerColor: 'black',
    perfectPlay: -6.0,
    startFen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 6 5',
  },
  {
    id: 4,
    playerColor: 'white',
    perfectPlay:  1.0,
    startFen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 7 5',
  },
  {
    id: 5,
    playerColor: 'white',
    perfectPlay: 10.0,
    startFen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2BPP3/2N2N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
  },
  {
    id: 6,
    playerColor: 'black',
    perfectPlay: -5.0,
    startFen: 'r1bqk2r/pppp1ppp/2n2n2/2b5/2BPp3/2N2N2/PPP2PPP/R1BQK2R b KQkq - 0 6',
  },
];

window.MOVES_PER_PUZZLE = 5;
