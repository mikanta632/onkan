// マイク入力を定期的に読み、音高を推定して平滑化した結果を渡す

import { createPitchDetector } from './pitch-detector.js';
import { freqToMidi, midiToFreq } from './note-utils.js';

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} input マイク入力
 * @param {object} opts
 * @param {(pitch: {freq:number, midi:number, rms:number} | null, now:number) => void} opts.onPitch
 *        推定のたびに呼ばれる。無音・雑音・無効化中は null。now は performance.now() 基準
 */
export function createPitchTracker(ctx, input, {
  onPitch,
  intervalMs = 30,  // 推定の間隔
  smoothing = 5,    // 中央値をとる個数
  holdFrames = 3,   // 推定が途切れても直前の値を保つフレーム数
  detector = {},
} = {}) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  input.connect(analyser);
  // ブラウザによっては出力につながっていないノードが処理されないので、無音で出力へつなぐ
  const mute = ctx.createGain();
  mute.gain.value = 0;
  analyser.connect(mute);
  mute.connect(ctx.destination);

  const buffer = new Float32Array(analyser.fftSize);
  const detect = createPitchDetector(detector);
  const history = [];
  let missCount = 0;
  let last = null;
  let enabled = true;
  let rafId = 0;
  let lastTick = -Infinity;

  function clear() {
    history.length = 0;
    missCount = 0;
    last = null;
  }

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    if (now - lastTick < intervalMs) return;
    lastTick = now;

    if (!enabled) {
      onPitch(null, now);
      return;
    }

    analyser.getFloatTimeDomainData(buffer);
    // サンプリングレートは毎回 AudioContext から取る（端末ごとに異なるため）
    const r = detect(buffer, ctx.sampleRate);
    if (!r) {
      missCount++;
      if (missCount >= holdFrames) clear();
      onPitch(last, now);
      return;
    }
    missCount = 0;
    history.push(freqToMidi(r.freq));
    if (history.length > smoothing) history.shift();
    const midi = median(history);
    last = { freq: midiToFreq(midi), midi, rms: r.rms };
    onPitch(last, now);
  }

  return {
    start() {
      if (!rafId) rafId = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      clear();
    },
    /** false の間は推定せず null を返し続ける（お手本の再生中など） */
    setEnabled(value) {
      enabled = value;
      clear();
    },
  };
}
