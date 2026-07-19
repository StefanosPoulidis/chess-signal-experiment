#!/usr/bin/env python3
"""Validate every configured puzzle and compare its signal with Stockfish."""

import json
import pathlib
import shutil
import subprocess
import sys

import chess
import chess.engine


ROOT = pathlib.Path(__file__).resolve().parents[1]
NODE_EXTRACT = r"""
const fs = require('fs');
const vm = require('vm');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/puzzles.js', 'utf8'), sandbox);
process.stdout.write(JSON.stringify(sandbox.window.PUZZLES));
"""


def load_puzzles():
    result = subprocess.run(
        ['node', '-e', NODE_EXTRACT],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def main():
    engine_path = shutil.which('stockfish')
    if not engine_path:
        raise RuntimeError('stockfish executable is required')

    puzzles = load_puzzles()
    engine = chess.engine.SimpleEngine.popen_uci(engine_path)
    try:
        for puzzle in puzzles:
            board = chess.Board(puzzle['startFen'])
            expected_color = chess.WHITE if puzzle['playerColor'] == 'white' else chess.BLACK
            if board.turn != expected_color:
                raise AssertionError(f"puzzle {puzzle['id']}: player color does not match side to move")

            signal_move = chess.Move.from_uci(puzzle['bestMove'])
            if signal_move not in board.legal_moves:
                raise AssertionError(f"puzzle {puzzle['id']}: signal move is illegal")

            result = engine.play(board, chess.engine.Limit(nodes=250000))
            if result.move != signal_move:
                raise AssertionError(
                    f"puzzle {puzzle['id']}: configured {signal_move.uci()} but Stockfish returned {result.move.uci()}"
                )
    finally:
        engine.quit()

    print(f'puzzle legality and Stockfish contract ok ({len(puzzles)} puzzles)')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise
