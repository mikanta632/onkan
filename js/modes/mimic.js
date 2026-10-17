// 「発声練習」モード
// お手本を 1 音鳴らし、声を出し始めてから n 秒間の音程を記録する。
// そのうちお手本の ±許容幅に入っていた時間の割合が基準以上なら正解。

import { ensureAudio, isAudioSupported, preparePlayback, reopenMic, releaseMic } from '../audio-engine.js';
import { TonePlayer } from '../tone-player.js';
import { createPitchTracker } from '../pitch-tracker.js';
import { createRatioJudge } from '../judge.js';
import { createTrace } from '../trace.js';
import { midiToFreq, midiToName, centsBetween, foldOctave } from '../note-utils.js';
import { getSettings } from '../settings.js';
import { recordAttempt } from '../storage.js';

export const MODE_ID = 'mimic';
const METER_RANGE = 50;       // メーターの端 = ±50 セント
const PLAYBACK_TAIL_MS = 100; // お手本の残響を拾わないよう、再生後に少し待ってからマイクを戻す
const RING_LENGTH = 2 * Math.PI * 90;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickTarget(low, high, prev) {
  if (high <= low) return low;
  let m;
  do {
    m = low + Math.floor(Math.random() * (high - low + 1));
  } while (m === prev);
  return m;
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
  };
  const trace = createTrace($('trace'));

  // init: マイク未準備 / ready: 出題待ち / waiting: 声を待っている / recording: 記録中 / result: 判定済み
  let state = 'init';
  let active = true;
  let playing = false;
  let token = 0;
  let player = null;
  let tracker = null;
  let target = null;
  let judge = null;
  let matchedMidis = []; // 合っていたときの声の高さ（オクターブ違いの表示用）
  let deadline = 0;
  let settings = getSettings();

  el.ring.style.strokeDasharray = String(RING_LENGTH);

  const isAsking = () => state === 'waiting' || state === 'recording';

  // ---------- 表示 ----------

  function setStatus(text) {
    el.status.textContent = text;
  }

  function render() {
    const labels = { init: 'はじめる', ready: '出題する', waiting: '次の問題', recording: '次の問題', result: '次の問題' };
    el.main.textContent = labels[state];
    el.replay.disabled = target === null;
    root.dataset.state = state;
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
      el.direction.innerHTML = '&nbsp;';
      el.needle.hidden = true;
      root.classList.remove('is-in', 'is-high', 'is-low');
      return;
    }
    const sign = cents > 0 ? '+' : cents < 0 ? '−' : '±';
    const abs = Math.abs(cents);
    el.cents.textContent = abs <= METER_RANGE
      ? `${sign}${Math.round(abs)} セント`
      : `${sign}${Math.round(abs / 100)} 半音`;

    const inRange = abs <= settings.toleranceCents;
    root.classList.toggle('is-in', inRange);
    root.classList.toggle('is-high', !inRange && cents > 0);
    root.classList.toggle('is-low', !inRange && cents < 0);
    const little = abs <= 100 ? '少し' : '';
    el.direction.textContent = inRange ? 'ぴったり！'
      : cents > 0 ? `高い ▲ ${little}下げて` : `低い ▼ ${little}上げて`;

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

  // ---------- 音声 ----------

  async function setupAudio() {
    const { ctx, input } = await ensureAudio();
    if (!player) player = new TonePlayer(ctx);
    if (!tracker) {
      tracker = createPitchTracker(ctx, input, { onPitch });
      tracker.start();
    }
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

  function centsFor(freq) {
    const c = centsBetween(freq, midiToFreq(target));
    return settings.allowOctave ? foldOctave(c) : c;
  }

  function onPitch(pitch, now) {
    if (playing || !active) {
      renderPitch(null, null);
      return;
    }
    const cents = pitch && target !== null ? centsFor(pitch.freq) : null;
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
      trace.push(r.elapsed, cents);
      if (r.inRange) matchedMidis.push(pitch.midi);
    }
    renderProgress(r.progress);
    setStatus(`記録中… 合っている割合 ${Math.round(r.ratio * 100)}%`);
    if (r.done) finish(r.passed, 'ratio', r.ratio);
  }

  // ---------- 出題と判定 ----------

  function newAttempt() {
    judge = createRatioJudge({
      toleranceCents: settings.toleranceCents,
      durationMs: settings.recordMs,
      passRatio: settings.passRatio,
    });
    matchedMidis = [];
    trace.reset(settings.recordMs, settings.toleranceCents);
    renderProgress(0);
  }

  /**
   * お手本を鳴らし、終わったらマイクを戻して声を待つ。
   * preparePlayback() がタップ中に resume を呼べるよう、タップのハンドラから await を挟まずに呼ぶ。
   */
  async function playReference() {
    const my = ++token;
    playing = true;
    tracker.setEnabled(false);
    if (isAsking()) {
      // 記録の途中で聞き直したら、記録はやり直し
      state = 'waiting';
      newAttempt();
      render();
      setStatus('お手本を再生中…');
    }
    // マイクを手放して再生専用にしてから鳴らす（iOS で音が小さくなるのを防ぐ）
    await preparePlayback();
    if (my !== token) return; // 途中で別の再生や中断があった
    await player.play(midiToFreq(target));
    await sleep(PLAYBACK_TAIL_MS);
    if (my !== token) return;
    if (!active) {
      playing = false; // マイクは練習画面に戻ったときに戻す
      return;
    }
    try {
      await reopenMic();
    } catch (err) {
      playing = false;
      showAudioError(err);
      return;
    }
    if (my !== token) {
      // マイクを取り直している間に次の再生が始まった
      releaseMic();
      return;
    }
    playing = false;
    tracker.setEnabled(true);
    if (state === 'waiting') {
      deadline = performance.now() + settings.timeLimitSec * 1000;
      renderTime(1);
      setStatus(`声を出すと記録が始まります（${settings.recordMs / 1000}秒間）。`);
    }
  }

  function nextQuestion() {
    settings = getSettings();
    target = pickTarget(settings.rangeLow, settings.rangeHigh, target);
    clearDisplay();
    renderRule();
    newAttempt();
    el.target.textContent = midiToName(target);
    state = 'waiting';
    render();
    playReference();
  }

  /** 合っていたときの声が、お手本と何オクターブ違ったか（最も多かったもの） */
  function octaveNote() {
    if (!matchedMidis.length) return '';
    const counts = new Map();
    for (const m of matchedMidis) {
      const o = Math.round((m - target) / 12);
      counts.set(o, (counts.get(o) || 0) + 1);
    }
    const octaves = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (octaves === 0) return '';
    return `。${Math.abs(octaves)}オクターブ${octaves < 0 ? '下' : '上'}の ${midiToName(target + 12 * octaves)} で歌っていました`;
  }

  /** @param {'ratio'|'timeout'|'pass'} reason */
  function finish(correct, reason, ratio = 0) {
    if (!isAsking()) return;
    state = 'result';
    recordAttempt(MODE_ID, correct);
    root.classList.add(correct ? 'is-correct' : 'is-wrong');
    el.badge.textContent = correct ? '正解！' : '残念';
    renderTime(0);
    const name = midiToName(target);
    if (reason === 'ratio') {
      const summary = `合っていた割合 ${Math.round(ratio * 100)}%（${settings.passRatio}%以上で正解）`;
      setStatus(correct ? `${summary}${octaveNote()}。` : `${summary}。お手本は ${name} でした。`);
    } else if (reason === 'timeout') {
      setStatus(`声が聞き取れないまま時間切れです。お手本は ${name} でした。`);
    } else {
      setStatus(`パスしました。お手本は ${name} でした。`);
    }
    render();
    onRecorded?.();
  }

  function abortQuestion() {
    token++;
    player?.stop();
    playing = false;
    target = null;
    state = 'ready';
    el.target.textContent = '—';
    clearDisplay();
    trace.reset(settings.recordMs, settings.toleranceCents);
    setStatus('「出題する」をタップすると次の問題を出します。');
    render();
  }

  // ---------- ボタン ----------

  async function onMain() {
    if (state === 'init') {
      // 最初のタップで AudioContext の開始とマイクの許可要求を行う（iOS の制約）
      try {
        await setupAudio();
      } catch (err) {
        showAudioError(err);
        return;
      }
    } else if (isAsking()) {
      // 解答中に「次の問題」を押したら不正解として記録してから次へ
      finish(false, 'pass');
    }
    nextQuestion();
  }

  function onReplay() {
    if (target !== null && player) playReference();
  }

  el.main.addEventListener('click', onMain);
  el.replay.addEventListener('click', onReplay);

  if (!isAudioSupported()) {
    el.main.disabled = true;
    setStatus(window.isSecureContext
      ? 'このブラウザはマイク入力に対応していません。'
      : 'マイクを使うには https:// のページで開いてください。');
  }
  renderRule();
  render();

  return {
    id: MODE_ID,
    /** このモードが表示されたとき */
    activate() {
      active = true;
      settings = getSettings();
      renderRule();
      trace.redraw();
      // 判定後の画面に戻ったら、声の表示を続けられるようマイクを戻す
      if (state === 'result' && tracker && !playing) {
        reopenMic().then(() => tracker.setEnabled(active)).catch(() => {});
      }
    },
    /** 他の画面へ移ったとき・アプリが裏に回ったとき。解答中の問題は記録せず取り消し、マイクも手放す */
    deactivate() {
      active = false;
      if (isAsking()) abortQuestion();
      tracker?.setEnabled(false);
      releaseMic();
    },
  };
}
