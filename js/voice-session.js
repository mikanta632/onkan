// 発声練習（1音・音程・フレーズ）で共有する音声の管理
// マイクを開くのは「声を待っている間と記録中」だけ。お手本の再生中・判定後・終了後は手放す。

import { ensureAudio, preparePlayback, reopenMic, releaseMic } from './audio-engine.js';
import { TonePlayer } from './tone-player.js';
import { createPitchTracker } from './pitch-tracker.js';
import { midiToFreq } from './note-utils.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAYBACK_TAIL_MS = 100; // お手本の残響を拾わないよう、再生後に少し待ってからマイクを開く

let player = null;
let tracker = null;
let listener = null;
let token = 0;

/**
 * 最初のタップで呼ぶ：AudioContext の開始とマイクの許可（iOS ではタップの中で行う必要がある）
 */
export async function startVoice() {
  const { ctx, input } = await ensureAudio();
  player ??= new TonePlayer(ctx);
  tracker ??= createPitchTracker(ctx, input, { onPitch: (p, now) => listener?.(p, now) });
}

/** 音高の推定結果を受け取る関数を登録する（表示中のモードが呼ぶ） */
export function setPitchListener(fn) {
  listener = fn;
}

/**
 * 音を順に鳴らし、鳴らし終えたらマイクを開いて声を聞き始める。
 * マイクは再生前に手放す（iOS で音が小さくなるのを防ぐ）。タップのハンドラから await を挟まずに呼ぶこと。
 * 要素は MIDI 番号か、{ midi: 番号または和音の配列, sec: 長さ, gapMs: 直前の間 }。
 * @param {(number|{midi: number|number[], sec?: number, gapMs?: number})[]} items
 * @param {{ noteSec?: number, gapMs?: number, listen?: boolean }} opts listen: false なら鳴らすだけ
 * @returns {Promise<boolean>} 最後まで進めたら true。途中で別の再生や停止があれば false
 */
export async function playThenListen(items, { noteSec = 1.2, gapMs = 120, listen = true } = {}) {
  const my = ++token;
  stopListening();
  await preparePlayback();
  for (let i = 0; i < items.length; i++) {
    const item = typeof items[i] === 'number' ? { midi: items[i] } : items[i];
    if (i > 0) await sleep(item.gapMs ?? gapMs);
    if (my !== token) return false;
    const freqs = [].concat(item.midi).map(midiToFreq);
    await player.play(freqs.length > 1 ? freqs : freqs[0], { duration: item.sec ?? noteSec });
    if (my !== token) return false;
  }
  if (!listen) return true;
  await sleep(PLAYBACK_TAIL_MS);
  if (my !== token) return false;
  await reopenMic(); // 失敗したら呼び出し側へ例外を投げる
  if (my !== token) {
    releaseMic(); // マイクを開いている間に次の再生や停止があった
    return false;
  }
  tracker.start();
  tracker.setEnabled(true);
  return true;
}

/** 声を聞くのをやめ、マイクを手放す */
export function stopListening() {
  tracker?.setEnabled(false);
  tracker?.stop();
  releaseMic();
}

/** 再生も含めてすべて止める（終了ボタン・画面の切り替え） */
export function stopAll() {
  token++;
  player?.stop();
  stopListening();
}
