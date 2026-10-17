// 「許容幅の中を一定時間保てたか」の判定

/**
 * @param {object} opts
 * @param {number} opts.toleranceCents 許容幅（±セント）
 * @param {number} opts.holdMs 保てば正解になる時間
 * @param {number} [opts.gapMs] 推定が一瞬途切れた（null）ときに許す時間
 */
export function createHoldJudge({ toleranceCents, holdMs, gapMs = 150 }) {
  let holdStart = null;
  let lastInRange = null;

  return {
    reset() {
      holdStart = null;
      lastInRange = null;
    },

    /**
     * @param {number|null} cents お手本からのずれ。推定できなければ null
     * @param {number} now performance.now() 基準の時刻
     * @returns {{inRange: boolean, progress: number, done: boolean}}
     */
    update(cents, now) {
      const inRange = cents !== null && Math.abs(cents) <= toleranceCents;
      if (inRange) {
        if (holdStart === null) holdStart = now;
        lastInRange = now;
      } else if (cents === null && holdStart !== null && now - lastInRange < gapMs) {
        // 息継ぎ程度の途切れは保持を続ける
      } else {
        holdStart = null;
      }
      const held = holdStart === null ? 0 : now - holdStart;
      return {
        inRange,
        progress: Math.min(1, held / holdMs),
        done: inRange && held >= holdMs,
      };
    },
  };
}
