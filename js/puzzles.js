// Puzzles for the chess-signal experiment.
//
// `bestMove` (optional, UCI format like 'e2e4' or 'e7e8q') hard-codes the
// move shown by the `act` signal (banner text + arrow). If null, the live
// Stockfish best move is used as a fallback. For research, set this per
// puzzle so the participant always sees the designed "correct" move.

window.PUZZLES = [
  {
    id: 1,
    playerColor: 'white',
    perfectPlay:  5.8,
    bestMove: 'g4g7',   // Qg7+
    startFen: '5r1k/3q1p1p/pb2pP2/1p3n2/1Pr1BPQ1/P2p2PK/1BnP3P/1R5R w - - 0 1',
  },
  {
    id: 2,
    playerColor: 'white',
    perfectPlay: 4.1,
    bestMove: 'g2h3',   // Kh3
    startFen: '6k1/2R2r1p/p3pRpQ/1p6/1P6/P5P1/3r2KP/3q4 w - - 0 1',
  },
  {
    id: 3,
    playerColor: 'white',
    perfectPlay: 6.0,
    bestMove: 'b3f7',   // Bxf7+
    startFen: 'r2qkbnr/1b1ppppp/p1n5/1p6/4P3/1B1P1N2/PB1N1PPP/R2QK2R w KQkq - 0 1',
  },
  {
    id: 4,
    playerColor: 'black',
    perfectPlay: -8.07,
    bestMove: 'c4h4',   // Rxh4
    startFen: '8/2R5/3Prbpk/1p3p1p/p1r4P/B1p1PqP1/2RP1P2/1Q4K1 b - - 2 4',
  },
  {
    id: 5,
    playerColor: 'white',
    perfectPlay: 6.16,
    bestMove: 'g6h6',   // Rxh6+
    startFen: '1r6/1r5k/3p2Rp/q1pPbb1P/p4p2/P1N2P2/1PP3Q1/2K1B1R1 w - - 0 1',
  },
  {
    id: 6,
    playerColor: 'black',
    perfectPlay: -5.0,
    bestMove: 'e2f1',   // Qxf1+
    startFen: '5rk1/2R2r1p/p1P3pB/1p1Q1b2/8/6P1/PP2q2P/5RK1 b - - 0 1',
  },
];

window.MOVES_PER_PUZZLE = 5;
