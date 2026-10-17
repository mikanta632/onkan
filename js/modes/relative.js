// 「相対音感」モード：基準音と 2 つ目の音を聞き、2 つ目の音を鍵盤で答える
// 基準音の鍵盤には「基準」と印を付ける。

import { createKeyboardQuiz } from './keyboard-quiz.js';
import { INTERVAL_NAMES, noteLabel } from '../note-utils.js';

export const MODE_ID = 'relative';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makeQuestion(s, previous) {
  let q;
  // 直前と同じ問題が続かないよう、何度か引き直す
  for (let i = 0; i < 10; i++) {
    const interval = pick(s.relIntervals);
    const dir = s.relDirection === 'both' ? pick([1, -1]) : s.relDirection === 'down' ? -1 : 1;
    const base = 60 + Math.floor(Math.random() * 12); // 基準音は C4〜B4
    const second = base + dir * interval;
    q = {
      notes: [base, second],
      answerMidi: second,
      baseMidi: base,
      enabledPcs: null,
      prompt: `基準音は ${noteLabel(base)}。2つ目の音は？`,
      reveal: `${noteLabel(second)}・基準から${INTERVAL_NAMES[interval]}${dir > 0 ? '上' : '下'}`,
    };
    if (!previous || previous.baseMidi !== base || previous.answerMidi !== second) break;
  }
  return q;
}

export function createRelativeMode(root, hooks = {}) {
  return createKeyboardQuiz(root, {
    id: MODE_ID,
    intro: '基準音と2つ目の音を聞いて、2つ目の音を鍵盤で答えます。',
    makeQuestion,
    ...hooks,
  });
}
