// 1 オクターブ（12 音）の鍵盤。押された鍵盤のピッチクラス（0 = ド 〜 11 = シ）を知らせる

import { DO_NAMES, NOTE_NAMES } from './note-utils.js';

const WHITE = [0, 2, 4, 5, 7, 9, 11];
// [ピッチクラス, 右側にある白鍵の番号]
const BLACK = [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]];
const MARKS = ['is-base', 'is-correct', 'is-wrong'];

/**
 * @param {HTMLElement} container
 * @param {{ onPress: (pc: number) => void }} opts
 */
export function createKeyboard(container, { onPress }) {
  container.classList.add('keyboard');
  container.innerHTML = '';
  const keys = new Map();

  function makeKey(pc, cls, html) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `kb-key ${cls}`;
    b.innerHTML = html;
    b.setAttribute('aria-label', `${DO_NAMES[pc]}（${NOTE_NAMES[pc]}）`);
    b.addEventListener('click', () => onPress(pc));
    keys.set(pc, b);
    return b;
  }

  const whites = document.createElement('div');
  whites.className = 'kb-whites';
  for (const pc of WHITE) {
    whites.append(makeKey(pc, 'kb-white',
      `<span class="kb-do">${DO_NAMES[pc]}</span><span class="kb-en">${NOTE_NAMES[pc]}</span>`));
  }
  container.append(whites);
  for (const [pc, idx] of BLACK) {
    const b = makeKey(pc, 'kb-black', `<span class="kb-do">${DO_NAMES[pc]}</span>`);
    b.style.left = `${(idx / WHITE.length) * 100}%`;
    container.append(b);
  }

  return {
    /** 押せる鍵盤を限定する。null ならすべて押せる */
    setEnabled(pcs) {
      for (const [pc, b] of keys) b.disabled = pcs ? !pcs.has(pc) : false;
    },
    /** 'is-base'（基準音）/ 'is-correct' / 'is-wrong' の印を付ける */
    mark(pc, cls) {
      keys.get(pc)?.classList.add(cls);
    },
    clearMarks() {
      for (const b of keys.values()) b.classList.remove(...MARKS);
    },
  };
}
