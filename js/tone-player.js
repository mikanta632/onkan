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
   * 1 音を鳴らす。鳴り終わる（または stop される）と resolve する。
   * 上下当てクイズなどで続けて鳴らすときは await で順番に呼ぶ。
   */
  play(freq, { duration = 1.2, volume = 0.7 } = {}) {
    this.stop();
    const { ctx } = this;
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.setPeriodicWave(this.wave);
    osc.frequency.setValueAtTime(freq, t0);
    // プツッというノイズを避けるため、立ち上がりと減衰を付ける
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.03);
    gain.gain.setValueAtTime(volume, t0 + duration - 0.15);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallback);
        osc.disconnect();
        gain.disconnect();
        if (this.current === osc) this.current = null;
        resolve();
      };
      // onended が来ない場合（コンテキストが止まった等）の保険
      const fallback = setTimeout(done, (duration + 0.5) * 1000);
      osc.onended = done;
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
      this.current = osc;
    });
  }

  stop() {
    if (!this.current) return;
    try { this.current.stop(); } catch { /* 既に止まっている */ }
    this.current = null;
  }
}
