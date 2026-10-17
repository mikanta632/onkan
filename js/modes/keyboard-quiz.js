// 「音を聞いて鍵盤で答える」クイズの共通部分。相対音感・絶対音感モードが使う
// 各モードは makeQuestion() で問題の中身だけを決める。
//
// makeQuestion(settings, previousQuestion) が返すもの:
//   notes       鳴らす音（MIDI 番号の配列。順に鳴らす）
//   answerMidi  正解の音（オクターブは問わず、ピッチクラスで判定する）
//   baseMidi    鍵盤に「基準」と印を付ける音（なければ null）
//   enabledPcs  押せる鍵盤（Set。null ならすべて）
//   prompt      問題文
//   reveal      判定後に出す正解の説明

import { preparePlayback } from '../audio-engine.js';
import { TonePlayer } from '../tone-player.js';
import { createKeyboard } from '../keyboard.js';
import { midiToFreq, pitchClass } from '../note-utils.js';
import { getSettings } from '../settings.js';
import { recordAttempt } from '../storage.js';

const NOTE_SEC = 0.9; // 1 音の長さ
const GAP_MS = 150;   // 音と音の間

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {HTMLElement} root
 * @param {{ id: string, intro: string, makeQuestion: Function, onRecorded?: () => void }} opts
 */
export function createKeyboardQuiz(root, { id, intro, makeQuestion, onRecorded }) {
  root.innerHTML = `
    <p class="quiz-prompt" data-el="prompt"></p>
    <div class="quiz-result">
      <div class="quiz-badge" data-el="badge"></div>
      <p class="quiz-reveal" data-el="reveal"></p>
    </div>
    <p class="status" data-el="status" role="status" aria-live="polite"></p>
    <div data-el="keyboard"></div>
    <div class="actions">
      <button type="button" class="btn btn-secondary" data-action="replay" disabled>もう一度聞く</button>
      <button type="button" class="btn btn-primary" data-action="main">はじめる</button>
    </div>`;
  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const el = {
    prompt: $('prompt'),
    badge: $('badge'),
    reveal: $('reveal'),
    status: $('status'),
    main: root.querySelector('[data-action="main"]'),
    replay: root.querySelector('[data-action="replay"]'),
  };

  // init: 音声未準備 / ready: 出題待ち / answering: 解答中 / result: 判定済み
  let state = 'init';
  let player = null;
  let token = 0;
  let question = null;
  let previous = null;
  const session = { attempts: 0, correct: 0 };

  const keyboard = createKeyboard($('keyboard'), { onPress });

  function render() {
    const labels = { init: 'はじめる', ready: '出題する', answering: '次の問題', result: '次の問題' };
    el.main.textContent = labels[state];
    el.replay.disabled = question === null;
    root.dataset.state = state;
  }

  function showIntro() {
    el.prompt.textContent = intro;
    el.badge.textContent = '';
    el.reveal.textContent = '';
    el.status.textContent = '鍵盤をタップすると、その音を聞けます。';
    root.classList.remove('is-correct', 'is-wrong');
  }

  // ---------- 音 ----------

  /** 音を順に鳴らす。タップのハンドラから await を挟まずに呼ぶこと（iOS で再生を始めるため） */
  async function playNotes(midis) {
    const my = ++token;
    const ctx = await preparePlayback();
    player ??= new TonePlayer(ctx);
    for (let i = 0; i < midis.length; i++) {
      if (i > 0) await sleep(GAP_MS);
      if (my !== token) return;
      await player.play(midiToFreq(midis[i]), { duration: NOTE_SEC });
      if (my !== token) return;
    }
  }

  function stopPlayback() {
    token++;
    player?.stop();
  }

  // ---------- 出題と判定 ----------

  function nextQuestion() {
    question = makeQuestion(getSettings(), previous);
    previous = question;
    state = 'answering';
    root.classList.remove('is-correct', 'is-wrong');
    el.prompt.textContent = question.prompt;
    el.badge.textContent = '';
    el.reveal.textContent = '';
    el.status.textContent = '音を聞いて、鍵盤で答えてください。';
    keyboard.clearMarks();
    keyboard.setEnabled(question.enabledPcs ?? null);
    if (question.baseMidi != null) keyboard.mark(pitchClass(question.baseMidi), 'is-base');
    render();
    playNotes(question.notes);
  }

  /** @param {number|null} pc 押した鍵盤。パスなら null */
  function finish(pc) {
    const answerPc = pitchClass(question.answerMidi);
    const correct = pc === answerPc;
    state = 'result';
    recordAttempt(id, correct);
    session.attempts += 1;
    if (correct) session.correct += 1;
    root.classList.add(correct ? 'is-correct' : 'is-wrong');
    el.badge.textContent = correct ? '正解！' : pc === null ? 'パス' : '残念';
    el.reveal.textContent = `正解は ${question.reveal}`;
    keyboard.setEnabled(null); // 判定後はどの鍵盤も押して音を確かめられる
    keyboard.mark(answerPc, 'is-correct');
    if (pc !== null && !correct) keyboard.mark(pc, 'is-wrong');
    el.status.textContent = `今回 ${session.attempts}問中 ${session.correct}問正解。鍵盤をタップすると、その音を聞けます。`;
    render();
    onRecorded?.();
  }

  function onPress(pc) {
    if (state === 'answering') {
      stopPlayback();
      finish(pc);
      return;
    }
    // 出題前・判定後は、押した鍵盤の音を（正解の音と同じオクターブで）鳴らす
    const ref = question ? question.answerMidi : 60;
    playNotes([ref - pitchClass(ref) + pc]);
  }

  function onMain() {
    if (state === 'answering') finish(null); // 解答中に「次の問題」を押したら不正解として記録
    nextQuestion();
  }

  function onReplay() {
    if (question) playNotes(question.notes);
  }

  el.main.addEventListener('click', onMain);
  el.replay.addEventListener('click', onReplay);
  showIntro();
  render();

  return {
    id,
    activate() {},
    /** 他の画面へ移ったとき。解答中の問題は記録せず取り消す */
    deactivate() {
      stopPlayback();
      if (state === 'answering') {
        question = null;
        state = 'ready';
        keyboard.clearMarks();
        keyboard.setEnabled(null);
        showIntro();
        render();
      }
    },
  };
}
