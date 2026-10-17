// 発声練習の判定：声を出し始めてから一定時間を記録し、合っていた割合で正誤を決める

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * 出だしと後半の、お手本からのずれ（中央値）。
 * 「出だしで外して、聞きながら直した」のか「最初から合っていた」のかを見るために使う。
 * @param {{t: number, c: number|null}[]} samples t は記録開始からの時間 [ms]、c はずれ [セント]
 * @param {number} durationMs 記録時間
 * @param {number} [onsetMs] 出だしとみなす長さ
 * @returns {{ onset: number|null, settled: number|null }}
 */
export function onsetStats(samples, durationMs, onsetMs = 200) {
  const voiced = samples.filter((p) => p.c !== null);
  return {
    onset: median(voiced.filter((p) => p.t <= onsetMs).map((p) => p.c)),
    settled: median(voiced.filter((p) => p.t >= durationMs / 2).map((p) => p.c)),
  };
}

/** セントを「+12」「−30」「±0」のように表す（null は「—」） */
export function formatCents(c) {
  if (c === null) return '—';
  const r = Math.round(c);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}`;
}

/**
 * @param {object} opts
 * @param {number} opts.toleranceCents 合っているとみなす幅（±セント）
 * @param {number} opts.durationMs 記録する時間
 * @param {number} opts.passRatio 正解に必要な割合（%）
 */
export function createRatioJudge({ toleranceCents, durationMs, passRatio }) {
  let start = null;
  let total = 0;
  let matched = 0;

  return {
    reset() {
      start = null;
      total = 0;
      matched = 0;
    },

    /**
     * 推定のたびに呼ぶ（一定間隔で呼ばれる前提で、回数の割合を時間の割合とみなす）。
     * 最初に声が検出された時点から記録を始める。
     * @param {number|null} cents お手本からのずれ。声が出ていなければ null
     * @param {number} now performance.now() 基準の時刻
     */
    update(cents, now) {
      if (start === null) {
        if (cents === null) return { recording: false, done: false };
        start = now;
      }
      const elapsed = now - start;
      const inRange = cents !== null && Math.abs(cents) <= toleranceCents;
      if (elapsed < durationMs) {
        // 記録中の途切れ（null）は「合っていない」として数える
        total += 1;
        if (inRange) matched += 1;
      }
      const ratio = total ? matched / total : 0;
      const done = elapsed >= durationMs;
      return {
        recording: true,
        inRange,
        elapsed: Math.min(elapsed, durationMs),
        progress: Math.min(1, elapsed / durationMs),
        ratio,
        done,
        passed: done && ratio * 100 >= passRatio,
      };
    },
  };
}
