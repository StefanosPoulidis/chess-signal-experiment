#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'experiment.html'), 'utf8');
const game = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const requiredQuestions = [
  'Before making my first move, I tried to understand the idea of the position and plan what I would do next.',
  'After making the first move, I often felt lost in the continuation.',
  'The first move sometimes led to positions that were harder to continue than I expected.',
  'The one-minute time limit affected my decisions.',
  'The signal I received was useful for helping me make decisions.',
  'I completed the chess task without using outside help, such as a chess engine, chess website, book, coach, parent, friend, or any other assistance.',
  'When I was shown the recommended move, I followed it even if I did not fully understand why it was good.',
  'When I was told there was a uniquely optimal move, I searched more carefully than I otherwise would have.',
];

assert(html.includes('id="survey-fields"'), 'survey form must render into #survey-fields');
assert(!html.includes('TBD'), 'survey placeholders must be removed');

for (const question of requiredQuestions) {
  assert(game.includes(question), `missing survey question text: ${question}`);
}

for (let i = 1; i <= 7; i += 1) {
  assert(game.includes(`name: 'q${i}'`), `missing stable survey field q${i}`);
}

for (const value of ['strongly_disagree', 'disagree', 'neither', 'agree', 'strongly_agree']) {
  assert(game.includes(`value: '${value}'`), `missing Likert value ${value}`);
}

assert(game.includes(`value: 'yes'`), 'Q6 must include yes option');
assert(game.includes(`value: 'no'`), 'Q6 must include no option');
assert(game.includes(`condition: 'act'`), 'Q7 action condition must be explicit');
assert(game.includes(`condition: 'att'`), 'Q7 attention condition must be explicit');

console.log('post-study survey contract ok');
