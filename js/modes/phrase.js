// 発声練習の「フレーズ」：2〜4 音の短いフレーズを聞いて、同じテンポで歌い返す
// 声を出し始めた時点から 1 音ずつ時間の枠を区切り、各音の枠の中で合っていた割合で合否を決める。
// 全部の音が合格なら正解。

import { isAudioSupported } from '../audio-engine.js';
import * as voice from '../voice-session.js';
import { onsetStats, formatCents } from '../judge.js';
import { createRoll } from '../roll.js';
import { midiToFreq, midiToName, centsBetween, foldOctave } from '../note-utils.js';
import { getSettings } from '../settings.js';
import { recordAttempt } from '../storage.js';

export const RECORD_ID = 'phrase';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MAX_JUMP = { step: 1, third: 2, fifth: 4 }; // 音階の上で何個先まで跳ぶか（2度・3度・5度）
const TRANSITION = 0.25; // 各音の最初の 25% は音の移り変わりとして判定に入れない
const ONSET_MS = 200;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** 長調の音階に沿ったフレーズを作る（出題範囲の中で、設定した跳び方まで） */
function makePhrase(s, previous) {
  let notes = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const key = Math.floor(Math.random() * 12);
    const all = [];
    for (let m = s.rangeLow; m <= s.rangeHigh; m++) all.push(m);
    let scale = all.filter((m) => MAJOR.includes((((m - key) % 12) + 12) % 12));
    if (scale.length < 2) scale = all;
    const maxJump = MAX_JUMP[s.phraseStep];
    let idx = Math.floor(Math.random() * scale.length);
    notes = [scale[idx]];
    for (let k = 1; k < s.phraseLength; k++) {
      const options = [];
      for (let d = -maxJump; d <= maxJump; d++) {
        if (d !== 0 && idx + d >= 0 && idx + d < scale.length) options.push(d);
      }
      if (options.length) idx += pick(options);
      notes.push(scale[idx]);
    }
    if (!previous || notes.join() !== previous.join()) break;
  }
  return notes;
}

export function createPhraseMode(root, { onRecorded } = {}) {
  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const el = {
    target: $('target'),
    rule: $('rule'),
    note: $('note'),
    cents: $('cents'),
    results: $('results'),
    time: $('time'),
    status: $('status'),
    main: root.querySelector('[data-action="main"]'),
    replay: root.querySelector('[data-action="replay"]'),
    end: root.querySelector('[data-action="end"]'),
  };
  const roll = createRoll($('roll'));

  // init: 未開始 / waiting: 声を待っている / recording: 記録中 / result: 判定済み
  let state = 'init';
  let active = false;
  let notes = null;
  let noteMs = 900;
  let start = 0;
  let samples = [];
  let deadline = Infinity;
  let settings = getSettings();

  const isAsking = () => state === 'waiting' || state === 'recording';

  // ---------- 表示 ----------

  function setStatus(text) {
    el.status.textContent = text;
  }

  function render() {
    el.main.textContent = state === 'init' ? 'はじめる' : '次の問題';
    el.replay.disabled = notes === null;
    el.end.disabled = state === 'init';
    root.dataset.state = state;
  }

  function renderRule() {
    const parts = [`1音ごとに±${settings.toleranceCents}セント・${settings.passRatio}%以上`];
    if (settings.allowOctave) parts.push('オクターブ違いOK');
    el.rule.textContent = parts.join('・');
  }

  function renderTime(ratio) {
    el.time.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  }

  function renderLive(pitch, cents) {
    el.note.textContent = pitch ? midiToName(pitch.midi) : '—';
    el.cents.textContent = cents === null ? '' : `${formatCents(cents)} セント`;
    const inRange = cents !== null && Math.abs(cents) <= settings.toleranceCents;
    root.classList.toggle('is-in', inRange);
    root.classList.toggle('is-high', cents !== null && !inRange && cents > 0);
    root.classList.toggle('is-low', cents !== null && !inRange && cents < 0);
  }

  function renderResults(results) {
    el.results.innerHTML = results
      ? results.map((r) => `<span class="nr ${r.passed ? 'is-ok' : 'is-ng'}">${midiToName(r.midi)} ${r.passed ? '○' : '×'} ${Math.round(r.ratio * 100)}%</span>`).join('')
      : '';
  }

  function clearDisplay() {
    renderLive(null, null);
    renderTime(0);
    renderResults(null);
    root.classList.remove('is-correct', 'is-wrong');
  }

  function showAudioError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      setStatus('マイクが許可されていません。iPhone の「設定 › Safari › マイク」で許可してから、ページを再読み込みしてください。');
    } else {
      setStatus(`音声を開始できませんでした（${name || err}）。`);
    }
  }

  // ---------- 判定 ----------

  function centsFor(freq, target) {
    const c = centsBetween(freq, midiToFreq(target));
    return settings.allowOctave ? foldOctave(c) : c;
  }

  function onPitch(pitch, now) {
    if (!active || !notes || !isAsking()) return;
    if (state === 'waiting') {
      if (!pitch) {
        const remain = deadline - now;
        renderTime(remain / (settings.timeLimitSec * 1000));
        if (remain <= 0) finish('timeout');
        return;
      }
      // 声が出たら記録開始。ここから 1 音ずつ時間の枠を進める
      state = 'recording';
      start = now;
      renderTime(0);
      render();
    }
    const t = now - start;
    if (t >= notes.length * noteMs) {
      finish('done');
      return;
    }
    const slot = Math.floor(t / noteMs);
    const cents = pitch ? centsFor(pitch.freq, notes[slot]) : null;
    renderLive(pitch, cents);
    samples.push({ t, slot, c: cents });
    roll.set({ samples, cursor: t });
    setStatus(`${slot + 1}音目（${midiToName(notes[slot])}）…`);
  }

  function judgeNotes() {
    return notes.map((midi, i) => {
      const s0 = i * noteMs;
      const inSlot = samples.filter((p) => p.slot === i);
      const judged = inSlot.filter((p) => p.t >= s0 + noteMs * TRANSITION);
      const matched = judged.filter((p) => p.c !== null && Math.abs(p.c) <= settings.toleranceCents).length;
      const ratio = judged.length ? matched / judged.length : 0;
      const { onset } = onsetStats(inSlot.map((p) => ({ t: p.t - s0, c: p.c })), noteMs, ONSET_MS);
      return { midi, ratio, onset, passed: ratio * 100 >= settings.passRatio };
    });
  }

  /** @param {'done'|'timeout'|'pass'} reason */
  function finish(reason) {
    if (!isAsking()) return;
    state = 'result';
    voice.stopListening(); // 判定が出たらマイクは手放す
    const names = notes.map(midiToName).join(' ');
    let correct = false;
    if (reason === 'done') {
      const results = judgeNotes();
      const passed = results.filter((r) => r.passed).length;
      correct = passed === results.length;
      roll.set({ cursor: null, results });
      renderResults(results);
      setStatus(`${results.length}音中${passed}音が合格（各音 ${settings.passRatio}%以上）。\n`
        + `出だしのずれ: ${results.map((r) => formatCents(r.onset)).join(' / ')} セント`);
    } else {
      roll.set({ cursor: null });
      setStatus(reason === 'timeout'
        ? `声が聞き取れないまま時間切れです。お手本は ${names} でした。`
        : `パスしました。お手本は ${names} でした。`);
    }
    recordAttempt(RECORD_ID, correct);
    root.classList.add(correct ? 'is-correct' : 'is-wrong');
    renderTime(0);
    render();
    onRecorded?.();
  }

  // ---------- 出題 ----------

  function newAttempt() {
    samples = [];
    deadline = Infinity;
    roll.set({ notes, noteMs, tolerance: settings.toleranceCents, samples, cursor: null, results: null });
    renderTime(0);
  }

  /** フレーズを鳴らし、鳴らし終えたらマイクを開いて声を待つ（タップのハンドラから await を挟まずに呼ぶ） */
  async function listen() {
    setStatus('お手本を再生中…');
    let ok;
    try {
      ok = await voice.playThenListen(notes, { noteSec: (noteMs - 60) / 1000, gapMs: 60 });
    } catch (err) {
      showAudioError(err);
      return;
    }
    if (!ok || state !== 'waiting') return;
    deadline = performance.now() + settings.timeLimitSec * 1000;
    renderTime(1);
    setStatus('声を出すと記録が始まります。線に合わせて同じテンポで歌ってください。');
  }

  function nextQuestion() {
    settings = getSettings();
    notes = makePhrase(settings, notes);
    noteMs = settings.phraseNoteMs;
    clearDisplay();
    renderRule();
    el.target.innerHTML = `<strong>${notes.length}音</strong>のフレーズ（1音 ${noteMs / 1000}秒）`;
    state = 'waiting';
    newAttempt();
    render();
    listen();
  }

  function reset(message) {
    voice.stopAll();
    notes = null;
    state = 'init';
    el.target.innerHTML = '短いフレーズを歌い返す';
    clearDisplay();
    roll.set({ notes: [], samples: [], cursor: null, results: null });
    setStatus(message);
    render();
  }

  // ---------- ボタン ----------

  async function onMain() {
    if (state === 'init') {
      try {
        await voice.startVoice();
      } catch (err) {
        showAudioError(err);
        return;
      }
    } else if (isAsking()) {
      finish('pass'); // 解答中に「次の問題」を押したら不正解として記録してから次へ
    }
    nextQuestion();
  }

  function onReplay() {
    if (!notes) return;
    if (state === 'result') {
      voice.playThenListen(notes, { noteSec: (noteMs - 60) / 1000, gapMs: 60, listen: false }).catch(() => {});
      return;
    }
    state = 'waiting'; // 解答中に聞き直したら、記録はやり直し
    clearDisplay();
    newAttempt();
    render();
    listen();
  }

  el.main.addEventListener('click', onMain);
  el.replay.addEventListener('click', onReplay);
  el.end.addEventListener('click', () => reset('終了しました。マイクは止まっています。「はじめる」で再開します。'));

  if (!isAudioSupported()) el.main.disabled = true;
  renderRule();
  reset(isAudioSupported()
    ? '2〜4音のフレーズを聞いて、同じテンポで歌い返します。'
    : 'このブラウザではマイクを使えません（https:// で開いてください）。');

  return {
    activate() {
      active = true;
      voice.setPitchListener(onPitch);
      settings = getSettings();
      renderRule();
      roll.redraw();
    },
    deactivate() {
      active = false;
      if (isAsking()) reset('中断しました。「はじめる」で再開します。');
      else voice.stopAll();
    },
  };
}
