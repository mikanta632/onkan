// 設定の読み書き（localStorage）

const KEY = 'onkan.settings.v2';
const OLD_KEY = 'onkan.settings.v1'; // v1 ではオクターブ違いの初期値がオフだった

export const DEFAULT_SETTINGS = {
  rangeLow: 60,        // 出題範囲の下限（MIDI 番号。60 = C4）
  rangeHigh: 67,       // 出題範囲の上限（67 = G4）
  toleranceCents: 30,  // 判定の許容幅（±セント）
  holdMs: 500,         // 正解に必要な保持時間
  timeLimitSec: 10,    // 1 問の制限時間
  allowOctave: true,   // オクターブ違いも正解にする（低い声・高い声どちらでも練習できるように）
};

export const LIMITS = {
  range: [48, 84],          // C3〜C6
  toleranceCents: [10, 50],
  holdMs: [300, 1500],
  timeLimitSec: [5, 30],
};

let cache = null;

const clamp = (v, [lo, hi], fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

function normalize(s) {
  const d = DEFAULT_SETTINGS;
  let low = clamp(s.rangeLow, LIMITS.range, d.rangeLow);
  let high = clamp(s.rangeHigh, LIMITS.range, d.rangeHigh);
  if (low > high) [low, high] = [high, low];
  return {
    rangeLow: low,
    rangeHigh: high,
    toleranceCents: clamp(s.toleranceCents, LIMITS.toleranceCents, d.toleranceCents),
    holdMs: clamp(s.holdMs, LIMITS.holdMs, d.holdMs),
    timeLimitSec: clamp(s.timeLimitSec, LIMITS.timeLimitSec, d.timeLimitSec),
    allowOctave: Boolean(s.allowOctave),
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
  cache = normalize({ ...getSettings(), ...patch });
  save(cache);
  return cache;
}

export function resetSettings() {
  cache = { ...DEFAULT_SETTINGS };
  save(cache);
  return cache;
}
