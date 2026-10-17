// 発声練習の「1音」「音程」
//   1音：お手本を 1 音鳴らし、同じ高さを歌う
//   音程：基準音を鳴らし、「長3度上」のように指定された音程の音を歌う
// どちらも、声を出し始めてから n 秒間を記録し、お手本の ±許容幅に入っていた時間の割合で正誤を決める。

import { isAudioSupported } from '../audio-engine.js';
import * as voice from '../voice-session.js';
import { createRatioJudge, onsetStats, formatCents } from '../judge.js';
import { createTrace } from '../trace.js';
import { midiToFreq, midiToName, noteLabel, centsBetween, foldOctave, INTERVAL_NAMES } from '../note-utils.js';
import { getSettings } from '../settings.js';
import { recordAttempt } from '../storage.js';

/** 記録に使う id（「1音」は以前からの記録を引き継ぐため mimic のまま） */
export const RECORD_IDS = { single: 'mimic', interval: 'mimic-interval' };

const METER_RANGE = 50; // メーターの端 = ±50 セント
const RING_LENGTH = 2 * Math.PI * 90;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function randomIn(low, high, avoid) {
  if (high <= low) return low;
  let m;
  do {
    m = low + Math.floor(Math.random() * (high - low + 1));
  } while (m === avoid);
  return m;
}

/**
 * @returns {{ target: number, reference: number[], reveal: number[], title: string }}
 *   target: 歌う音 / reference: 出題時に鳴らす音 / reveal: 判定後に「もう一度」で鳴らす音
 */
function makeQuestion(type, s, previous) {
  if (type === 'single') {
    const t = randomIn(s.rangeLow, s.rangeHigh, previous?.target);
    return { target: t, reference: [t], reveal: [t], title: `お手本 <strong>${midiToName(t)}</strong>` };
  }
  // 音程：オクターブ違いを正解にしていると「オクターブ」は基準音と同じ高さで済んでしまうので外す
  let intervals = s.relIntervals;
  if (s.allowOctave && intervals.some((n) => n !== 12)) intervals = intervals.filter((n) => n !== 12);
  let q;
  for (let i = 0; i < 20; i++) {
    const interval = pick(intervals);
    const dir = s.relDirection === 'both' ? pick([1, -1]) : s.relDirection === 'down' ? -1 : 1;
    const base = randomIn(s.rangeLow, s.rangeHigh);
    const target = base + dir * interval;
    q = {
      target,
      reference: [base],
      reveal: [base, target],
      title: `<strong>${noteLabel(base)}</strong> から <strong>${INTERVAL_NAMES[interval]}${dir > 0 ? '上' : '下'}</strong>`,
    };
    // オクターブ違いを認めないときは、歌う音が出題範囲から離れすぎないものを選ぶ
    const singable = s.allowOctave || (target >= s.rangeLow - 5 && target <= s.rangeHigh + 5);
    if (singable && target !== previous?.target) break;
  }
  return q;
}

/**
 * @param {HTMLElement} root モードの DOM（data-el / data-action を持つ要素を含む）
 * @param {{ onRecorded?: () => void }} hooks
 */
export function createMimicMode(root, { onRecorded } = {}) {
  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const el = {
    target: $('target'),
    rule: $('rule'),
    note: $('note'),
    cents: $('cents'),
    badge: $('badge'),
    direction: $('direction'),
    needle: $('needle'),
    zone: $('zone'),
    ring: $('ring'),
    time: $('time'),
    status: $('status'),
    main: root.querySelector('[data-action="main"]'),
    replay: root.querySelector('[data-action="replay"]'),
    end: root.querySelector('[data-action="end"]'),
  };
  const trace = createTrace($('trace'));

  let type = 'single';
  // init: 未開始 / waiting: 声を待っている / recording: 記録中 / result: 判定済み
  let state = 'init';
  let active = false;
  let question = null;
  let judge = null;
  let samples = [];      // 記録中のずれ { t, c }
  let matchedMidis = []; // 合っていたときの声の高さ（オクターブ違いの表示用）
  let deadline = Infinity;
  let settings = getSettings();

  el.ring.style.strokeDasharray = String(RING_LENGTH);

  const isAsking = () => state === 'waiting' || state === 'recording';

  // ---------- 表示 ----------

  function setStatus(text) {
    el.status.textContent = text;
  }

  function render() {
    el.main.textContent = state === 'init' ? 'はじめる' : '次の問題';
    el.replay.disabled = question === null;
    el.end.disabled = state === 'init';
    root.dataset.state = state;
  }

  function introText() {
    return type === 'single'
      ? 'お手本と同じ高さで「アー」と歌います。「はじめる」でマイクの使用許可を求めます。'
      : '基準音を聞いて、指定された音程の音を歌います。「はじめる」でマイクの使用許可を求めます。';
  }

  /** 判定条件の表示と、メーターの許容幅 */
  function renderRule() {
    const parts = [
      `±${settings.toleranceCents}セント`,
      `${settings.recordMs / 1000}秒中${settings.passRatio}%以上`,
    ];
    if (settings.allowOctave) parts.push('オクターブ違いOK');
    el.rule.textContent = parts.join('・');

    const tol = Math.min(settings.toleranceCents, METER_RANGE);
    const half = (tol / METER_RANGE) * 50;
    el.zone.style.left = `${50 - half}%`;
    el.zone.style.width = `${half * 2}%`;
  }

  function renderProgress(progress) {
    el.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - progress));
  }

  function renderTime(ratio) {
    el.time.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  }

  function renderPitch(pitch, cents) {
    el.note.textContent = pitch ? midiToName(pitch.midi) : '—';
    if (cents === null) {
      el.cents.innerHTML = '&nbsp;';
      el.direction.textContent = '';
      el.needle.hidden = true;
      root.classList.remove('is-in', 'is-high', 'is-low');
      return;
    }
    const abs = Math.abs(cents);
    el.cents.textContent = abs <= METER_RANGE
      ? `${formatCents(cents)} セント`
      : `${formatCents(cents / 100)} 半音`;

    const inRange = abs <= settings.toleranceCents;
    root.classList.toggle('is-in', inRange);
    root.classList.toggle('is-high', !inRange && cents > 0);
    root.classList.toggle('is-low', !inRange && cents < 0);
    const little = abs <= 100 ? '少し' : '';
    el.direction.textContent = inRange ? 'ぴったり！' : cents > 0 ? `${little}下げて` : `${little}上げて`;

    const clamped = Math.max(-METER_RANGE, Math.min(METER_RANGE, cents));
    el.needle.hidden = false;
    el.needle.style.left = `${50 + (clamped / METER_RANGE) * 50}%`;
    el.needle.classList.toggle('is-over', abs > METER_RANGE);
  }

  function clearDisplay() {
    renderPitch(null, null);
    renderProgress(0);
    renderTime(0);
    root.classList.remove('is-correct', 'is-wrong');
    el.badge.textContent = '';
  }

  function showAudioError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      setStatus('マイクが許可されていません。iPhone の「設定 › Safari › マイク」で許可してから、ページを再読み込みしてください。');
    } else if (name === 'NotFoundError') {
      setStatus('マイクが見つかりません。');
    } else {
      setStatus(`音声を開始できませんでした（${name || err}）。`);
    }
  }

  // ---------- 判定 ----------

  function centsFor(freq) {
    const c = centsBetween(freq, midiToFreq(question.target));
    return settings.allowOctave ? foldOctave(c) : c;
  }

  function onPitch(pitch, now) {
    if (!active || !question) return;
    const cents = pitch ? centsFor(pitch.freq) : null;
    renderPitch(pitch, cents);
    if (!isAsking()) return;

    const r = judge.update(cents, now);
    if (!r.recording) {
      // まだ声が出ていない：制限時間を数える
      const remain = deadline - now;
      renderTime(remain / (settings.timeLimitSec * 1000));
      if (remain <= 0) finish(false, 'timeout');
      return;
    }
    if (state === 'waiting') {
      state = 'recording';
      renderTime(0);
      render();
    }
    if (!r.done) {
      samples.push({ t: r.elapsed, c: cents });
      trace.push(r.elapsed, cents);
      if (r.inRange) matchedMidis.push(pitch.midi);
    }
    renderProgress(r.progress);
    setStatus(`記録中… 合っている割合 ${Math.round(r.ratio * 100)}%`);
    if (r.done) finish(r.passed, 'ratio', r.ratio);
  }

  /** 合っていたときの声が、お手本と何オクターブ違ったか（最も多かったもの） */
  function octaveNote() {
    if (!matchedMidis.length) return '';
    const counts = new Map();
    for (const m of matchedMidis) {
      const o = Math.round((m - question.target) / 12);
      counts.set(o, (counts.get(o) || 0) + 1);
    }
    const octaves = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (octaves === 0) return '';
    return `${Math.abs(octaves)}オクターブ${octaves < 0 ? '下' : '上'}の ${midiToName(question.target + 12 * octaves)} で歌っていました。`;
  }

  /** @param {'ratio'|'timeout'|'pass'} reason */
  function finish(correct, reason, ratio = 0) {
    if (!isAsking()) return;
    state = 'result';
    voice.stopListening(); // 判定が出たらマイクは手放す
    recordAttempt(RECORD_IDS[type], correct);
    root.classList.add(correct ? 'is-correct' : 'is-wrong');
    el.badge.textContent = correct ? '正解！' : '残念';
    renderTime(0);
    const answer = type === 'single' ? midiToName(question.target) : noteLabel(question.target);
    if (reason === 'ratio') {
      const { onset, settled } = onsetStats(samples, settings.recordMs);
      const lines = [
        `合っていた割合 ${Math.round(ratio * 100)}%（${settings.passRatio}%以上で正解）`,
        `出だし ${formatCents(onset)} → 後半 ${formatCents(settled)} セント。`,
      ];
      if (correct) lines.push(octaveNote());
      else if (type === 'interval') lines.push(`正解は ${answer} です。`);
      setStatus(lines.join('\n').trim());
    } else if (reason === 'timeout') {
      setStatus(`声が聞き取れないまま時間切れです。正解は ${answer} でした。`);
    } else {
      setStatus(`パスしました。正解は ${answer} でした。`);
    }
    render();
    onRecorded?.();
  }

  // ---------- 出題 ----------

  function newAttempt() {
    judge = createRatioJudge({
      toleranceCents: settings.toleranceCents,
      durationMs: settings.recordMs,
      passRatio: settings.passRatio,
    });
    samples = [];
    matchedMidis = [];
    deadline = Infinity;
    trace.reset(settings.recordMs, settings.toleranceCents);
    renderProgress(0);
    renderTime(0);
  }

  /** お手本を鳴らし、鳴らし終えたらマイクを開いて声を待つ（タップのハンドラから await を挟まずに呼ぶ） */
  async function listen() {
    setStatus(type === 'single' ? 'お手本を再生中…' : '基準音を再生中…');
    let ok;
    try {
      ok = await voice.playThenListen(question.reference);
    } catch (err) {
      showAudioError(err);
      return;
    }
    if (!ok || state !== 'waiting') return;
    deadline = performance.now() + settings.timeLimitSec * 1000;
    renderTime(1);
    setStatus(`声を出すと記録が始まります（${settings.recordMs / 1000}秒間）。`);
  }

  function nextQuestion() {
    settings = getSettings();
    question = makeQuestion(type, settings, question);
    clearDisplay();
    renderRule();
    newAttempt();
    el.target.innerHTML = question.title;
    state = 'waiting';
    render();
    listen();
  }

  /** 問題を記録せずに取りやめ、最初の状態に戻す */
  function reset(message) {
    voice.stopAll();
    question = null;
    state = 'init';
    el.target.innerHTML = type === 'single' ? 'お手本 <strong>—</strong>' : '基準音から指定の音程を歌う';
    clearDisplay();
    trace.reset(settings.recordMs, settings.toleranceCents);
    setStatus(message);
    render();
  }

  // ---------- ボタン ----------

  async function onMain() {
    if (state === 'init') {
      // 最初のタップで AudioContext の開始とマイクの許可要求を行う（iOS の制約）
      try {
        await voice.startVoice();
      } catch (err) {
        showAudioError(err);
        return;
      }
    } else if (isAsking()) {
      finish(false, 'pass'); // 解答中に「次の問題」を押したら不正解として記録してから次へ
    }
    nextQuestion();
  }

  function onReplay() {
    if (!question) return;
    if (state === 'result') {
      // 判定後は答え合わせ用に鳴らす（音程なら基準音と正解の音）
      voice.playThenListen(question.reveal, { listen: false }).catch(() => {});
      return;
    }
    // 解答中に聞き直したら、記録はやり直し
    state = 'waiting';
    clearDisplay();
    newAttempt();
    render();
    listen();
  }

  function onEnd() {
    reset('終了しました。マイクは止まっています。「はじめる」で再開します。');
  }

  el.main.addEventListener('click', onMain);
  el.replay.addEventListener('click', onReplay);
  el.end.addEventListener('click', onEnd);

  if (!isAudioSupported()) {
    el.main.disabled = true;
    setStatus(window.isSecureContext
      ? 'このブラウザはマイク入力に対応していません。'
      : 'マイクを使うには https:// のページで開いてください。');
  } else {
    setStatus(introText());
  }
  renderRule();
  render();

  return {
    /** 「1音」と「音程」を切り替える */
    setType(t) {
      if (t === type) return;
      type = t;
      reset(introText());
    },
    activate() {
      active = true;
      voice.setPitchListener(onPitch);
      settings = getSettings();
      renderRule();
      trace.redraw();
    },
    /** 他の画面へ移ったとき・アプリが裏に回ったとき。解答中の問題は記録せず取り消し、マイクも止める */
    deactivate() {
      active = false;
      if (isAsking()) reset('中断しました。「はじめる」で再開します。');
      else voice.stopAll();
    },
  };
}
