// YIN 法による基本周波数の推定
// DOM や Web Audio に依存しない純粋な処理なので、どのモードやテストからも使える。
// サンプリングレートは呼び出しごとに受け取るため、44.1kHz / 48kHz などに依存しない。

export const DEFAULT_DETECTOR_OPTIONS = {
  minFreq: 60,        // 推定する最低周波数 [Hz]
  maxFreq: 1100,      // 推定する最高周波数 [Hz]
  threshold: 0.15,    // YIN の閾値。小さいほど厳しく、雑音を拾いにくい
  rmsThreshold: 0.01, // これより小さい音量は無音とみなす
};

/**
 * 推定関数を作る。内部バッファを使い回すため、呼び出し側ごとに 1 つ作ること。
 * @returns {(samples: Float32Array, sampleRate: number) => ({freq: number, clarity: number, rms: number} | null)}
 */
export function createPitchDetector(options = {}) {
  const opts = { ...DEFAULT_DETECTOR_OPTIONS, ...options };
  let cmnd = new Float32Array(0);

  return function detect(samples, sampleRate) {
    const n = samples.length;

    // 1. 無音判定
    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / n);
    if (rms < opts.rmsThreshold) return null;

    const tauMin = Math.max(2, Math.floor(sampleRate / opts.maxFreq));
    const tauMax = Math.min(Math.floor(sampleRate / opts.minFreq), Math.floor(n / 2));
    if (tauMax <= tauMin + 2) return null;
    const windowSize = n - tauMax;
    if (cmnd.length < tauMax + 1) cmnd = new Float32Array(tauMax + 1);

    // 2. 差分関数と 3. 累積平均正規化差分関数（CMND）
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let d = 0;
      for (let j = 0; j < windowSize; j++) {
        const diff = samples[j] - samples[j + tau];
        d += diff * diff;
      }
      runningSum += d;
      cmnd[tau] = runningSum > 0 ? (d * tau) / runningSum : 1;
    }

    // 4. 閾値を下回る最初の谷を探す。見つからなければ周期性が弱い（雑音）とみなす
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < opts.threshold) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return null;

    // 5. 放物線補間で周期を細かく求める
    let betterTau = tau;
    if (tau > 1 && tau < tauMax) {
      const s0 = cmnd[tau - 1];
      const s1 = cmnd[tau];
      const s2 = cmnd[tau + 1];
      const denom = s0 - 2 * s1 + s2;
      if (denom !== 0) betterTau = tau + (s0 - s2) / (2 * denom);
    }

    const freq = sampleRate / betterTau;
    if (freq < opts.minFreq || freq > opts.maxFreq) return null;
    return { freq, clarity: 1 - cmnd[tau], rms };
  };
}
