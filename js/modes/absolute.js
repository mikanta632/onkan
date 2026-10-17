// 「絶対音感」モード：基準音なしで 1 音を聞き、その音名を鍵盤で答える（オクターブは問わない）

import { createKeyboardQuiz } from './keyboard-quiz.js';
import { WHITE_PCS, noteLabel, pitchClass } from '../note-utils.js';

export const MODE_ID = 'absolute';

function makeQuestion(s, previous) {
  const all = [];
  for (let m = s.absRangeLow; m <= s.absRangeHigh; m++) all.push(m);
  let candidates = s.absNoteSet === 'white' ? all.filter((m) => WHITE_PCS.has(pitchClass(m))) : all;
  if (!candidates.length) candidates = all;
  // 直前と同じ音は避ける（候補が 1 つしかなければそのまま）
  const fresh = candidates.filter((m) => !previous || m !== previous.answerMidi);
  const pool = fresh.length ? fresh : candidates;
  const midi = pool[Math.floor(Math.random() * pool.length)];
  return {
    notes: [midi],
    answerMidi: midi,
    baseMidi: null,
    enabledPcs: s.absNoteSet === 'white' ? WHITE_PCS : null,
    prompt: '鳴った音はどれ？',
    reveal: noteLabel(midi),
  };
}

export function createAbsoluteMode(root, hooks = {}) {
  return createKeyboardQuiz(root, {
    id: MODE_ID,
    intro: '1音だけ聞いて、その音名を鍵盤で答えます（オクターブは問いません）。',
    makeQuestion,
    ...hooks,
  });
}
