// お手本の音を鳴らす（Web Audio API のオシレーター）

// 倍音の強さ（基音, 2倍音, 3倍音, ...）
// スマホのスピーカーは低音が出にくいため、倍音を多めに含めて聞こえやすくする
const HARMONICS = [1, 0.75, 0.55, 0.4, 0.28, 0.18, 0.1, 0.06];

export class TonePlayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.current = null;
    const real = new Float32Array(HARMONICS.length + 1);
    const imag = new Float32Array([0, ...HARMONICS]);
    this.wave = ctx.createPeriodicWave(real, imag);
  }

  /**
   * 1 音（周波数の配列なら和音）を鳴らす。鳴り終わる（または stop される）と resolve する。
   * 上下当てクイズなどで続けて鳴らすときは await で順番に呼ぶ。
   * @param {number|number[]} freq
   */
  play(freq, { duration = 1.2, volume = 0.7 } = {}) {
    this.stop();
    const { ctx } = this;
    const freqs = [].concat(freq);
    const level = freqs.length > 1 ? (volume * 1.2) / freqs.length : volume; // 和音は重なって大きくなる分を下げる
    const t0 = ctx.currentTime + 0.02;
    const gain = ctx.createGain();
    // プツッというノイズを避けるため、立ち上がりと減衰を付ける
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level, t0 + 0.03);
    gain.gain.setValueAtTime(level, Math.max(t0 + 0.03, t0 + duration - 0.15));
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    gain.connect(ctx.destination);
    const oscs = freqs.map((f) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(this.wave);
      osc.frequency.setValueAtTime(f, t0);
      osc.connect(gain);
      return osc;
    });

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallback);
        oscs.forEach((o) => o.disconnect());
        gain.disconnect();
        if (this.current === oscs) this.current = null;
        resolve();
      };
      // onended が来ない場合（コンテキストが止まった等）の保険
      const fallback = setTimeout(done, (duration + 0.5) * 1000);
      oscs[0].onended = done;
      for (const o of oscs) {
        o.start(t0);
        o.stop(t0 + duration + 0.02);
      }
      this.current = oscs;
    });
  }

  stop() {
    if (!this.current) return;
    for (const o of this.current) {
      try { o.stop(); } catch { /* 既に止まっている */ }
    }
    this.current = null;
  }
}
