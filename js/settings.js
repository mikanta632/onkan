// 設定の読み書き（localStorage）

const KEY = 'onkan.settings.v2';
const OLD_KEY = 'onkan.settings.v1'; // v1 ではオクターブ違いの初期値がオフだった

export const MODES = ['mimic', 'relative', 'absolute'];

export const DEFAULT_SETTINGS = {
  mode: 'mimic',        // 最後に選んだ練習

  // 発声練習
  rangeLow: 60,         // 出題範囲の下限（MIDI 番号。60 = C4）
  rangeHigh: 67,        // 出題範囲の上限（67 = G4）
  toleranceCents: 30,   // 合っているとみなす幅（±セント）
  recordMs: 2000,       // 声を出し始めてから記録する時間
  passRatio: 70,        // 記録中に合っていた時間の割合がこれ以上なら正解（%）
  timeLimitSec: 10,     // 声を出し始めるまでの制限時間
  allowOctave: true,    // オクターブ違いも正解にする（低い声・高い声どちらでも練習できるように）

  // 相対音感
  relIntervals: [2, 4, 5, 7, 12], // 出題する音程（半音数）
  relDirection: 'up',             // up: 上行 / down: 下行 / both: 両方

  // 絶対音感
  absNoteSet: 'white',  // white: 白鍵のみ / all: 12 音すべて
  absRangeLow: 60,      // C4
  absRangeHigh: 71,     // B4
};

export const LIMITS = {
  range: [48, 84],          // C3〜C6
  toleranceCents: [10, 50],
  recordMs: [1000, 5000],
  passRatio: [50, 100],
  timeLimitSec: [5, 30],
};

let cache = null;

const clamp = (v, [lo, hi], fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

const oneOf = (v, options, fallback) => (options.includes(v) ? v : fallback);

function rangePair(low, high, d) {
  let lo = clamp(low, LIMITS.range, d[0]);
  let hi = clamp(high, LIMITS.range, d[1]);
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

function normalize(s) {
  const d = DEFAULT_SETTINGS;
  const [rangeLow, rangeHigh] = rangePair(s.rangeLow, s.rangeHigh, [d.rangeLow, d.rangeHigh]);
  const [absRangeLow, absRangeHigh] = rangePair(s.absRangeLow, s.absRangeHigh, [d.absRangeLow, d.absRangeHigh]);
  const intervals = Array.isArray(s.relIntervals)
    ? [...new Set(s.relIntervals.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 12).sort((a, b) => a - b)
    : [];
  return {
    mode: oneOf(s.mode, MODES, d.mode),
    rangeLow,
    rangeHigh,
    toleranceCents: clamp(s.toleranceCents, LIMITS.toleranceCents, d.toleranceCents),
    recordMs: clamp(s.recordMs, LIMITS.recordMs, d.recordMs),
    passRatio: clamp(s.passRatio, LIMITS.passRatio, d.passRatio),
    timeLimitSec: clamp(s.timeLimitSec, LIMITS.timeLimitSec, d.timeLimitSec),
    allowOctave: Boolean(s.allowOctave),
    relIntervals: intervals.length ? intervals : [...d.relIntervals],
    relDirection: oneOf(s.relDirection, ['up', 'down', 'both'], d.relDirection),
    absNoteSet: oneOf(s.absNoteSet, ['white', 'all'], d.absNoteSet),
    absRangeLow,
    absRangeHigh,
  };
}

function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存できない環境では一時的な設定になる */ }
}

export function getSettings() {
  if (!cache) {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY));
      if (!stored) {
        // v1 の設定は引き継ぎ、オクターブ違いだけ新しい初期値（オン）にする
        const old = JSON.parse(localStorage.getItem(OLD_KEY));
        stored = old ? { ...old, allowOctave: true } : {};
      }
    } catch {
      stored = {};
    }
    cache = normalize({ ...DEFAULT_SETTINGS, ...stored });
  }
  return cache;
}

/** 一部の項目を更新し、補正後の設定を返す */
export function updateSettings(patch) {
  const p = { ...patch };
  // 音程を全部外そうとしたときは、直前の選択を残す
  if (Array.isArray(p.relIntervals) && p.relIntervals.length === 0) delete p.relIntervals;
  cache = normalize({ ...getSettings(), ...p });
  save(cache);
  return cache;
}

/** 練習の設定を初期値に戻す（選んでいるモードはそのまま） */
export function resetSettings() {
  cache = { ...DEFAULT_SETTINGS, relIntervals: [...DEFAULT_SETTINGS.relIntervals], mode: getSettings().mode };
  save(cache);
  return cache;
}
