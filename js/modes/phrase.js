// 発声練習の「フレーズ」：短いフレーズを聞いて（または階名を見て）、同じテンポで歌う
// 出題は「レベル・ランダム・型・曲の一節」の 4 種類。出題の前に主和音を鳴らして調を示す。
// 声を出し始めた時点から 1 音ずつ時間の枠を区切り、各音の枠の中で合っていた割合で合否を決める。
// 全部の音が合格なら正解。

import { isAudioSupported } from '../audio-engine.js';
import * as voice from '../voice-session.js';
import { onsetStats, formatCents } from '../judge.js';
import { createRoll } from '../roll.js';
import { midiToFreq, midiToName, centsBetween, foldOctave, intervalLabel } from '../note-utils.js';
import { getSettings, updateSettings } from '../settings.js';
import { recordAttempt, getIntervalStats, recordIntervals } from '../storage.js';
import { makeQuestion, tonicChord, solfaName, levelLabel, LEVELS, KIND_LABELS } from '../phrase-bank.js';

export const RECORD_ID = 'phrase';

const TRANSITION = 0.25; // 各音の最初の 25% は音の移り変わりとして判定に入れない
const ONSET_MS = 200;
const NOTE_GAP_MS = 60;  // お手本の音と音の間
const CUE_SEC = 1.2;     // 主和音の長さ
const CUE_GAP_MS = 600;  // 主和音からフレーズまでの間
const LEVEL_STREAK = 3;  // 何問続けて正解（不正解）でレベルを上げる（下げる）か

const TONALITY = { major: '長調', minor: '短調' };

export function createPhraseMode(root, { onRecorded } = {}) {
  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const el = {
    kinds: root.querySelectorAll('[data-kind]'),
    target: $('target'),
    rule: $('rule'),
    solfa: $('solfa'),
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
  let q = null;      // 出題中のフレーズ（phrase-bank.js の makeQuestion の戻り値）
  let times = [];    // 各音の [始まり, 終わり]（ms）
  let start = 0;
  let samples = [];
  let deadline = Infinity;
  let streak = 0;    // レベルの連続記録：正なら連続正解、負なら連続不正解
  let settings = getSettings();

  const isAsking = () => state === 'waiting' || state === 'recording';
  const isReading = () => settings.phrasePrompt === 'read';
  const solfaOf = (i) => solfaName(q.offsets[i]);

  // ---------- 表示 ----------

  function setStatus(text) {
    el.status.textContent = text;
  }

  function render() {
    el.main.textContent = state === 'init' ? 'はじめる' : '次の問題';
    el.replay.disabled = q === null;
    el.end.disabled = state === 'init';
    root.dataset.state = state;
    el.kinds.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kind === settings.phraseKind)));
  }

  function renderRule() {
    const parts = [`各音±${settings.toleranceCents}セント・${settings.passRatio}%以上`];
    if (settings.allowOctave) parts.push('オクターブ違いOK');
    el.rule.textContent = parts.join('・');
  }

  function streakDots() {
    const n = Math.max(0, streak);
    return `<span class="streak" aria-label="連続正解 ${n}">${'●'.repeat(n)}${'○'.repeat(LEVEL_STREAK - n)}</span>`;
  }

  /** 出題の種類と、いま何を練習しているか */
  function renderTarget() {
    const kind = settings.phraseKind;
    const head = kind === 'level' ? `レベル ${settings.phraseLevel}` : KIND_LABELS[kind];
    let detail;
    if (kind === 'level') {
      detail = `${levelLabel(settings.phraseLevel)} ${streakDots()}`;
    } else if (!q) {
      detail = { random: '設定した音数・跳び方で作る', pattern: '音階・和音などよく出る動き', song: '知っている曲の一節' }[kind];
    } else if (q.name) {
      detail = `${q.name}${q.credit ? `（${q.credit}）` : ''}・${TONALITY[q.tonality]}`;
    } else {
      detail = `${TONALITY[q.tonality]}・${q.notes.length}音`;
    }
    el.target.innerHTML = `<strong>${head}</strong> ${detail}`;
  }

  /** 階名の並び（「階名を見て歌う」では最初から、「聞いて歌う」では答え合わせで出す） */
  function renderSolfa(show) {
    el.solfa.textContent = show && q ? q.offsets.map((o) => solfaName(o)).join('・') : '';
    roll.set({ labels: show && q ? q.offsets.map((o) => solfaName(o)) : null });
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
      ? results.map((r, i) => `<span class="nr ${r.passed ? 'is-ok' : 'is-ng'}" title="${midiToName(r.midi)}">${solfaOf(i)} ${r.passed ? '○' : '×'} ${Math.round(r.ratio * 100)}%</span>`).join('')
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
    if (!active || !q || !isAsking()) return;
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
    const slot = times.findIndex(([, end]) => t < end);
    if (slot < 0) {
      finish('done');
      return;
    }
    const cents = pitch ? centsFor(pitch.freq, q.notes[slot]) : null;
    renderLive(pitch, cents);
    samples.push({ t, slot, c: cents });
    roll.set({ samples, cursor: t });
    setStatus(`${slot + 1}音目（${solfaOf(slot)}）…`);
  }

  function judgeNotes() {
    return q.notes.map((midi, i) => {
      const [s0, e0] = times[i];
      const len = e0 - s0;
      const inSlot = samples.filter((p) => p.slot === i);
      const judged = inSlot.filter((p) => p.t >= s0 + len * TRANSITION);
      const matched = judged.filter((p) => p.c !== null && Math.abs(p.c) <= settings.toleranceCents).length;
      const ratio = judged.length ? matched / judged.length : 0;
      const { onset } = onsetStats(inSlot.map((p) => ({ t: p.t - s0, c: p.c })), len, ONSET_MS);
      return { midi, ratio, onset, passed: ratio * 100 >= settings.passRatio };
    });
  }

  /** レベルの上げ下げ。変わったときはお知らせの文を返す */
  function updateLevel(correct) {
    if (settings.phraseKind !== 'level') return '';
    streak = correct ? Math.max(streak, 0) + 1 : Math.min(streak, 0) - 1;
    let level = settings.phraseLevel;
    if (streak >= LEVEL_STREAK && level < LEVELS.length) level += 1;
    else if (streak <= -LEVEL_STREAK && level > 1) level -= 1;
    else return '';
    const up = level > settings.phraseLevel;
    streak = 0;
    settings = updateSettings({ phraseLevel: level });
    return up ? `\nレベル ${level} に上がりました！` : `\nレベル ${level} に下げて練習します。`;
  }

  /** @param {'done'|'timeout'|'pass'} reason */
  function finish(reason) {
    if (!isAsking()) return;
    state = 'result';
    voice.stopListening(); // 判定が出たらマイクは手放す
    const names = q.offsets.map((o) => solfaName(o)).join('・');
    let correct = false;
    let message;
    if (reason === 'done') {
      const results = judgeNotes();
      const passed = results.filter((r) => r.passed).length;
      correct = passed === results.length;
      recordIntervals(results.slice(1).map((r, i) => ({ semis: q.notes[i + 1] - q.notes[i], ok: r.passed })));
      roll.set({ cursor: null, results });
      renderResults(results);
      const missed = results
        .map((r, i) => (i > 0 && !r.passed ? `${solfaOf(i - 1)}→${solfaOf(i)}（${intervalLabel(q.notes[i] - q.notes[i - 1])}）` : null))
        .filter(Boolean);
      message = `${results.length}音中${passed}音が合格（各音 ${settings.passRatio}%以上）。`
        + (missed.length ? `\n外した音程: ${missed.join('、')}` : '')
        + `\n出だしのずれ: ${results.map((r) => formatCents(r.onset)).join(' / ')} セント`;
    } else {
      roll.set({ cursor: null });
      message = reason === 'timeout'
        ? `声が聞き取れないまま時間切れです。お手本は ${names} でした。`
        : `パスしました。お手本は ${names} でした。`;
    }
    recordAttempt(RECORD_ID, correct);
    message += updateLevel(correct);
    setStatus(message);
    renderSolfa(true);
    renderTarget();
    root.classList.add(correct ? 'is-correct' : 'is-wrong');
    renderTime(0);
    render();
    onRecorded?.();
  }

  // ---------- 出題 ----------

  function newAttempt() {
    samples = [];
    deadline = Infinity;
    roll.set({ notes: q.notes, times, tolerance: settings.toleranceCents, samples, cursor: null, results: null });
    renderSolfa(isReading());
    renderTime(0);
  }

  /** 鳴らすもの：主和音（設定または「階名を見て歌う」とき）と、お手本のフレーズ */
  function playlist({ cue, model }) {
    const items = [];
    if (cue) items.push({ midi: tonicChord(q), sec: CUE_SEC });
    if (model) {
      times.forEach(([s0, e0], i) => {
        items.push({
          midi: q.notes[i],
          sec: (e0 - s0 - NOTE_GAP_MS) / 1000,
          gapMs: i === 0 ? CUE_GAP_MS : NOTE_GAP_MS,
        });
      });
    }
    return items;
  }

  /** 主和音とフレーズを鳴らし、鳴らし終えたらマイクを開いて声を待つ（タップのハンドラから await を挟まずに呼ぶ） */
  async function listen() {
    const reading = isReading();
    setStatus(reading ? '主和音を再生中…' : 'お手本を再生中…');
    let ok;
    try {
      ok = await voice.playThenListen(playlist({ cue: settings.phraseCue || reading, model: !reading }));
    } catch (err) {
      showAudioError(err);
      return;
    }
    if (!ok || state !== 'waiting') return;
    deadline = performance.now() + settings.timeLimitSec * 1000;
    renderTime(1);
    setStatus(reading
      ? '階名を見て、主和音の調で歌ってください。声を出すと記録が始まります。'
      : '声を出すと記録が始まります。線に合わせて同じテンポで歌ってください。');
  }

  function nextQuestion() {
    settings = getSettings();
    q = makeQuestion(settings.phraseKind, settings, {
      level: settings.phraseLevel,
      stats: getIntervalStats(),
      previous: q,
    });
    const beatMs = settings.phraseNoteMs;
    let t = 0;
    times = q.durs.map((d) => {
      const span = [t, t + d * beatMs];
      t += d * beatMs;
      return span;
    });
    clearDisplay();
    renderRule();
    renderTarget();
    state = 'waiting';
    newAttempt();
    render();
    listen();
  }

  function reset(message) {
    voice.stopAll();
    q = null;
    state = 'init';
    clearDisplay();
    renderTarget();
    el.solfa.textContent = '';
    roll.set({ notes: [], times: [], labels: null, samples: [], cursor: null, results: null });
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
    if (!q) return;
    if (state === 'result') {
      voice.playThenListen(playlist({ cue: settings.phraseCue, model: true }), { listen: false }).catch(() => {});
      return;
    }
    state = 'waiting'; // 解答中に聞き直したら、記録はやり直し
    clearDisplay();
    newAttempt();
    render();
    listen();
  }

  /** 出題の種類を変える。出題中なら記録せずに新しい種類で出し直す */
  function onKind(kind) {
    if (kind === settings.phraseKind) return;
    settings = updateSettings({ phraseKind: kind });
    streak = 0;
    if (state === 'init') {
      renderTarget();
      render();
      return;
    }
    q = null;
    nextQuestion();
  }

  el.main.addEventListener('click', onMain);
  el.replay.addEventListener('click', onReplay);
  el.end.addEventListener('click', () => reset('終了しました。マイクは止まっています。「はじめる」で再開します。'));
  el.kinds.forEach((b) => b.addEventListener('click', () => onKind(b.dataset.kind)));

  if (!isAudioSupported()) el.main.disabled = true;
  renderRule();
  reset(isAudioSupported()
    ? '主和音で調を聞いてから、フレーズを同じテンポで歌い返します。'
    : 'このブラウザではマイクを使えません（https:// で開いてください）。');

  return {
    activate() {
      active = true;
      voice.setPitchListener(onPitch);
      settings = getSettings();
      renderRule();
      renderTarget();
      render();
      roll.redraw();
    },
    deactivate() {
      active = false;
      if (isAsking()) reset('中断しました。「はじめる」で再開します。');
      else voice.stopAll();
    },
  };
}
