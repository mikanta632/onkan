// お手本の音を鳴らす（Web Audio API のオシレーター）

export class TonePlayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.current = null;
  }

  /**
   * 1 音を鳴らす。鳴り終わる（または stop される）と resolve する。
   * 上下当てクイズなどで続けて鳴らすときは await で順番に呼ぶ。
   */
  play(freq, { duration = 1.2, type = 'triangle', volume = 0.45 } = {}) {
    this.stop();
    const { ctx } = this;
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
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
