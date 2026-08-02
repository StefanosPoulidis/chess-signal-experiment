#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expected = {
  'vendor/jquery-3.7.1/jquery.min.js': 'fc9a93dd241f6b045cbff0481cf4e1901becd0e12fb45166a8f17f95823f0b1a',
  'vendor/chess.js-0.10.3/chess.js': '1a6803b787dc4a6f71aabdd0b010cee7bf0fc70ce032f5ed8d7738684d431bfc',
  'vendor/chessboardjs-1.0.0/chessboard.min.js': '68d033595ff24f38a50534b0da8fa14a76b8c0f3b3e6b7d2636bfa26c47f6675',
  'vendor/chessboardjs-1.0.0/chessboard.min.css': '1c1748d2ed9803ed44311a4b04ada62a2ae3508ea91b6b4b29872e5c4dd77dde',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/bB.png': '670d669100cf7cfd08c2729d9bebb01b5a4e42dc376e6cb502afe4f05fb4a600',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/bK.png': 'c3addc101ab6f2165857fcd799a5ac728d78f6823d7004c1c7548cb62b84e05c',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/bN.png': 'bd7f71976cd28a7bc0479b551031cde53ede5b5e454d612222c2a184779dfd9a',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/bP.png': 'a375ca340e6c5ad22245a9da1d2ba99e6d27013c6af06423ee1480fb92f17c49',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/bQ.png': '4071a8569386152a6286a5597ea79039c10f539808433247b3b7d98425f25712',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/bR.png': '2f94d399fcd37abfa483e282c93aceddbd56780ea325b07fa66ad9a5ce6268f4',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/wB.png': 'c10edcf5ff649c7e89eb91e31a167c9b37c3febae9634caeec472abddaf89bb9',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/wK.png': '4cdcdd4680a0d527891fb3c831f214de39eee19f43efa13d0c4c54ccd600ab09',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/wN.png': '539d3d56e9e6486f9f326e6110f723b83c78a3a41bd468f7155ff124ccb0718b',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/wP.png': '9bf2286c59507adb7a6045c212a6b92a9defd7e9a5bbae30e82bb83216c43cb1',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/wQ.png': '05cb6801d02f39363977f6d7ae9a40f605b2aa69866e9086868c08e1df17f875',
  'vendor/chessboardjs-1.0.0/img/chesspieces/wikipedia/wR.png': '175ea2252a01052113dff85380e8237246448c762ae303ae2a348d971ba0800b',
};

for (const [relativePath, expectedHash] of Object.entries(expected)) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`vendor checksum mismatch: ${relativePath}`);
}

const html = fs.readFileSync(path.join(root, 'experiment.html'), 'utf8');
const board = fs.readFileSync(path.join(root, 'js', 'board.js'), 'utf8');
if (/<(script|link)[^>]+https?:\/\//i.test(html) || /pieceTheme:\s*['"]https?:\/\//i.test(board)) {
  throw new Error('experiment runtime must not depend on third-party CDNs');
}

console.log('self-hosted vendor asset contract ok');
