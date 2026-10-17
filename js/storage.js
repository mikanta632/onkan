// 日ごとの挑戦数と正解数の記録（localStorage）
// 形式: { "2026-10-17": { mimic: { attempts: 5, correct: 3 }, ... }, ... }
// モード別に持つので、別のクイズを追加しても記録が混ざらない。

const KEY = 'onkan.records.v1';

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 保存できない環境では記録しない */ }
}

/** 端末のローカル日付で "YYYY-MM-DD" を返す */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function recordAttempt(mode, correct, date = new Date()) {
  const data = load();
  const day = (data[dateKey(date)] ??= {});
  const r = (day[mode] ??= { attempts: 0, correct: 0 });
  r.attempts += 1;
  if (correct) r.correct += 1;
  save(data);
  return r;
}

/** その日のモード別記録 */
export function getDay(key = dateKey()) {
  return load()[key] ?? {};
}

/** 新しい日付順の一覧 [{ date, modes: { mimic: {...} } }] */
export function getDailyRecords() {
  const data = load();
  return Object.keys(data).sort().reverse().map((date) => ({ date, modes: data[date] }));
}

export function clearRecords() {
  try { localStorage.removeItem(KEY); } catch { /* 何もしない */ }
}
