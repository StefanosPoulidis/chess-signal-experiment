'use strict';

// Thin wrapper around chessboard.js (v1) + SVG arrow overlay.
// Exposes: create({ fen, playerColor, onMove }), clearArrows(), drawArrow(from,to),
// setPosition(fen), flipIfNeeded(color), destroy().
//
// Requires jQuery and chessboard.js to be loaded globally before this file.

window.Board = (() => {
  let board = null;
  let svgOverlay = null;
  let containerEl = null;

  function create({ elementId, fen, playerColor, onDrop, onDragStart }) {
    containerEl = document.getElementById(elementId);
    board = Chessboard(elementId, {
      position: fen,
      draggable: true,
      orientation: playerColor, // 'white' or 'black'
      pieceTheme: 'https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png',
      onDrop,
      onDragStart,
    });
    ensureOverlay();
    return board;
  }

  // Click-to-move support. chessboard.js v1 marks squares with a class like
  // "square-e4" (no data-square attribute), so we scan up the DOM for that
  // class pattern.
  function extractSquareFromElement(el, limit) {
    while (el && el !== limit) {
      if (el.classList) {
        for (const cls of el.classList) {
          if (/^square-[a-h][1-8]$/.test(cls)) {
            return cls.slice(7);
          }
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function setupClickHandler(handler) {
    if (!containerEl) return;
    const wrapper = containerEl.querySelector('[class^="board-"]') || containerEl;
    if (wrapper._clickHandler) {
      wrapper.removeEventListener('click', wrapper._clickHandler);
    }
    const fn = (e) => {
      const square = extractSquareFromElement(e.target, wrapper);
      if (square) handler(square);
    };
    wrapper.addEventListener('click', fn);
    wrapper._clickHandler = fn;
  }

  function highlight(square, className) {
    if (!containerEl) return;
    const wrapper = containerEl.querySelector('[class^="board-"]');
    if (!wrapper) return;
    const sq = wrapper.querySelector('.square-' + square);
    if (sq) sq.classList.add(className);
  }

  function clearHighlight(className) {
    if (!containerEl) return;
    const wrapper = containerEl.querySelector('[class^="board-"]');
    if (!wrapper) return;
    wrapper.querySelectorAll('.' + className).forEach(el => el.classList.remove(className));
  }

  function ensureOverlay() {
    if (!containerEl) return;
    if (svgOverlay) svgOverlay.remove();
    svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.setAttribute('class', 'board-arrows');
    svgOverlay.style.position = 'absolute';
    svgOverlay.style.left = '0';
    svgOverlay.style.top = '0';
    svgOverlay.style.width = '100%';
    svgOverlay.style.height = '100%';
    svgOverlay.style.pointerEvents = 'none';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#228B22"/>
      </marker>`;
    svgOverlay.appendChild(defs);

    // Attach inside chessboard.js's inner wrapper so size + coords align.
    const wrapper = containerEl.querySelector('[class^="board-"]') || containerEl;
    wrapper.style.position = 'relative';
    wrapper.appendChild(svgOverlay);
  }

  function sqCenter(square, orientation) {
    // square like 'e4' -> pixel center within the overlay.
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
    const rank = parseInt(square[1], 10) - 1;              // 0..7
    const rect = svgOverlay.getBoundingClientRect();
    const size = rect.width; // square overlay: width == height
    const sq = size / 8;
    let x, y;
    if (orientation === 'white') {
      x = file * sq + sq / 2;
      y = (7 - rank) * sq + sq / 2;
    } else {
      x = (7 - file) * sq + sq / 2;
      y = rank * sq + sq / 2;
    }
    return { x, y };
  }

  function drawArrow(from, to, orientation) {
    clearArrows();
    const a = sqCenter(from, orientation);
    const b = sqCenter(to, orientation);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x);
    line.setAttribute('y2', b.y);
    line.setAttribute('stroke', '#228B22');
    line.setAttribute('stroke-width', Math.max(6, svgOverlay.getBoundingClientRect().width / 60));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    line.setAttribute('opacity', '0.85');
    svgOverlay.appendChild(line);
  }

  function clearArrows() {
    if (!svgOverlay) return;
    // Keep the <defs>, remove everything else
    [...svgOverlay.children].forEach(ch => {
      if (ch.tagName.toLowerCase() !== 'defs') ch.remove();
    });
  }

  function setPosition(fen) {
    if (board) board.position(fen, false); // no animation
  }

  function resize() {
    if (board && board.resize) board.resize();
    ensureOverlay();
  }

  function destroy() {
    if (board && board.destroy) board.destroy();
    board = null;
    if (svgOverlay) { svgOverlay.remove(); svgOverlay = null; }
  }

  return { create, drawArrow, clearArrows, setPosition, resize, destroy,
           setupClickHandler, highlight, clearHighlight };
})();
