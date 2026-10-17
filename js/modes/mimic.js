// 「声でまねる」モード
// お手本を 1 音鳴らし、ユーザーの声がお手本の ±許容幅に一定時間収まれば正解。
//
// モードは共通して { id, activate(), deactivate() } を持つ。
// 上下当てクイズなどを追加するときは、同じ形で modes/ に置き main.js に登録する。

import { ensureAudio, isAudioSupported } from '../audio-engine.js';
import { TonePlayer } from '../tone-player.js';
import { createPitchTracker } from '../pitch-tracker.js';
import { createHoldJudge } from '../judge.js';
import { midiToFreq, midiToName, centsBetween, foldOctave } from '../note-utils.js';
import { getSettings } from '../settings.js';
import { recordAttempt } from '../storage.js';

export const MODE_ID = 'mimic';
const METER_RANGE = 50;       // メーターの端 = ±50 セント
const PLAYBACK_TAIL_MS = 200; // お手本の残響を拾わないよう、再生後もしばらくマイクを止める
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

  // init: マイク未準備 / ready: 出題待ち / listening: 解答中 / result: 判定済み
  let state = 'init';
  let active = true;
  let playing = false;
  let token = 0;
  let player = null;
  let tracker = null;
  let target = null;
  let judge = null;
  let deadline = 0;
  let settings = getSettings();

  el.ring.style.strokeDasharray = String(RING_LENGTH);

  // ---------- 表示 ----------

  function setStatus(text) {
    el.status.textContent = text;
  }

  function render() {
    const labels = { init: 'はじめる', ready: '出題する', listening: '次の問題', result: '次の問題' };
    el.main.textContent = labels[state];
    el.replay.disabled = target === null;
    root.dataset.state = state;
  }

  function renderZone() {
    const tol = Math.min(settings.toleranceCents, METER_RANGE);
    const half = (tol / METER_RANGE) * 50;
    el.zone.style.left = `${50 - half}%`;
    el.zone.style.width = `${half * 2}%`;
  }

  function renderHold(progress) {
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
    renderHold(0);
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
    tracker.setEnabled(active && !playing);
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
    if (state !== 'listening') return;

    const r = judge.update(cents, now);
    renderHold(r.progress);
    const remain = deadline - now;
    renderTime(remain / (settings.timeLimitSec * 1000));
    if (r.done) finish(true);
    else if (remain <= 0) finish(false);
  }

  // ---------- 出題と判定 ----------

  async function playReference() {
    const my = ++token;
    playing = true;
    tracker.setEnabled(false);
    if (state === 'listening') {
      setStatus('お手本を再生中…');
      renderHold(0);
    }
    await player.play(midiToFreq(target));
    await sleep(PLAYBACK_TAIL_MS);
    if (my !== token) return; // 途中で別の再生や中断があった
    playing = false;
    tracker.setEnabled(active);
    if (state === 'listening') {
      judge.reset();
      deadline = performance.now() + settings.timeLimitSec * 1000;
      renderTime(1);
      setStatus('同じ高さで声を出して、そのまま保ってください。');
    }
  }

  function nextQuestion() {
    settings = getSettings();
    target = pickTarget(settings.rangeLow, settings.rangeHigh, target);
    judge = createHoldJudge({ toleranceCents: settings.toleranceCents, holdMs: settings.holdMs });
    clearDisplay();
    renderZone();
    el.target.textContent = midiToName(target);
    state = 'listening';
    render();
    playReference();
  }

  function finish(correct) {
    if (state !== 'listening') return;
    state = 'result';
    recordAttempt(MODE_ID, correct);
    root.classList.add(correct ? 'is-correct' : 'is-wrong');
    el.badge.textContent = correct ? '正解！' : '残念';
    renderHold(correct ? 1 : 0);
    renderTime(0);
    const name = midiToName(target);
    setStatus(correct
      ? `${name} を ${settings.holdMs / 1000} 秒キープできました。`
      : `時間切れです。お手本は ${name} でした。「もう一度聞く」で確かめられます。`);
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
    setStatus('「出題する」をタップすると次の問題を出します。');
    render();
  }

  // ---------- ボタン ----------

  async function onMain() {
    // 重要: ensureAudio はタップの中で最初に呼ぶ（iOS の制約）
    const wasPending = state === 'listening';
    try {
      await setupAudio();
    } catch (err) {
      showAudioError(err);
      return;
    }
    // 解答中に「次の問題」を押したら不正解として記録してから次へ
    if (wasPending && state === 'listening') {
      finish(false);
    }
    nextQuestion();
  }

  async function onReplay() {
    if (target === null) return;
    try {
      await setupAudio();
    } catch (err) {
      showAudioError(err);
      return;
    }
    if (target !== null) playReference();
  }

  el.main.addEventListener('click', onMain);
  el.replay.addEventListener('click', onReplay);

  if (!isAudioSupported()) {
    el.main.disabled = true;
    setStatus(window.isSecureContext
      ? 'このブラウザはマイク入力に対応していません。'
      : 'マイクを使うには https:// のページで開いてください。');
  }
  renderZone();
  render();

  return {
    id: MODE_ID,
    /** 練習タブに戻ったとき */
    activate() {
      active = true;
      settings = getSettings();
      renderZone();
      tracker?.setEnabled(!playing);
    },
    /** 他のタブへ移ったとき・アプリが裏に回ったとき。解答中の問題は記録せず取り消す */
    deactivate() {
      active = false;
      if (state === 'listening') abortQuestion();
      tracker?.setEnabled(false);
    },
  };
}
