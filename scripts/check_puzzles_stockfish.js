#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const enginePath = process.env.STOCKFISH_PATH || 'stockfish';
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'puzzles.js'), 'utf8'), sandbox);

const engine = spawn(enginePath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
let listeners = [];
engine.stdout.setEncoding('utf8');
engine.stdout.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop();
  lines.forEach(line => {
    listeners = listeners.filter(listener => {
      if (!listener.match(line)) return true;
      listener.resolve(line);
      return false;
    });
  });
});

function send(command) { engine.stdin.write(`${command}\n`); }
function waitFor(match) {
  return new Promise(resolve => listeners.push({ match, resolve }));
}

async function commandAndWait(command, match) {
  const pending = waitFor(match);
  send(command);
  return pending;
}

function parseScore(line) {
  const match = line.match(/ score (cp|mate) (-?\d+)/);
  if (!match) return null;
  if (match[1] === 'cp') return Number(match[2]);
  const distance = Number(match[2]);
  return distance > 0 ? 100000 - distance : -100000 - distance;
}

(async () => {
  await commandAndWait('uci', line => line === 'uciok');
  send('setoption name MultiPV value 2');
  await commandAndWait('isready', line => line === 'readyok');
  const results = [];
  for (const puzzle of sandbox.window.PUZZLES) {
    const multipv = new Map();
    const pending = new Promise(resolve => {
      const listener = {
        match(line) {
          if (line.startsWith('info ') && line.includes(' depth 20 ') && line.includes(' multipv ')) {
            const index = Number((line.match(/ multipv (\d+)/) || [])[1]);
            const pv = (line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/) || [])[1];
            const score = parseScore(line);
            if (index && pv && score !== null) multipv.set(index, { move: pv, score });
          }
          return line.startsWith('bestmove ');
        },
        resolve,
      };
      listeners.push(listener);
    });
    send(`position fen ${puzzle.startFen}`);
    send('go depth 20');
    const bestMoveLine = await pending;
    const bestMove = bestMoveLine.split(' ')[1];
    const best = multipv.get(1);
    const second = multipv.get(2);
    if (!best || !second) throw new Error(`puzzle ${puzzle.id}: missing depth-20 MultiPV scores`);
    const gap = best.score - second.score;
    if (bestMove !== puzzle.bestMove || best.move !== puzzle.bestMove) {
      throw new Error(`puzzle ${puzzle.id}: configured ${puzzle.bestMove}, Stockfish 18 returned ${bestMove}`);
    }
    if (gap < 60) throw new Error(`puzzle ${puzzle.id}: unique-best gap is ${gap} cp, below 60 cp`);
    results.push({ id: puzzle.id, bestMove, bestScore: best.score, secondMove: second.move, secondScore: second.score, gap });
  }
  send('quit');
  console.log(JSON.stringify(results, null, 2));
})().catch(error => {
  console.error(error.message);
  send('quit');
  process.exitCode = 1;
});
