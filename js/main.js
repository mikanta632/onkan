// 入口：タブ切り替え、設定フォーム、記録一覧、モードの登録

import { createMimicMode, MODE_ID as MIMIC } from './modes/mimic.js';
import { getSettings, updateSettings, resetSettings, LIMITS } from './settings.js';
import { getDailyRecords, getDay, clearRecords } from './storage.js';
import { midiToName } from './note-utils.js';

// モードを追加したらここに名前を足す
const MODE_LABELS = { [MIMIC]: '声まね' };

const mimic = createMimicMode(document.getElementById('mode-mimic'), { onRecorded: renderToday });
const activeMode = mimic;
let currentTab = 'practice';

// ---------- タブ ----------

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (name === 'practice') activeMode.activate();
  else activeMode.deactivate();
  if (name === 'records') renderRecords();
  document.querySelector('.app-main').scrollTop = 0;
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// アプリが裏に回ったら解答中の問題を取り消す（時間切れ扱いにしない）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) activeMode.deactivate();
  else if (currentTab === 'practice') activeMode.activate();
});

// ---------- 記録 ----------

function sum(modes) {
  return Object.values(modes).reduce(
    (acc, r) => ({ attempts: acc.attempts + r.attempts, correct: acc.correct + r.correct }),
    { attempts: 0, correct: 0 },
  );
}

const pct = (r) => (r.attempts ? Math.round((r.correct / r.attempts) * 100) : 0);

function renderToday() {
  const t = sum(getDay());
  document.getElementById('today-summary').textContent = t.attempts
    ? `今日 ${t.attempts}問・正解率 ${pct(t)}%`
    : '今日 0問';
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${w}）`;
}

function renderRecords() {
  const list = document.getElementById('records-list');
  const days = getDailyRecords();
  if (!days.length) {
    list.innerHTML = '<p class="empty">まだ記録がありません。練習すると日ごとに記録されます。</p>';
    return;
  }
  const rows = days.flatMap(({ date, modes }) =>
    Object.entries(modes).map(([mode, r], i) => `
      <tr>
        <th scope="row">${i === 0 ? formatDate(date) : ''}</th>
        <td>${MODE_LABELS[mode] ?? mode}</td>
        <td class="num">${r.correct}/${r.attempts}</td>
        <td class="rate">
          <span class="rate-bar"><span style="width:${pct(r)}%"></span></span>
          <span class="num">${pct(r)}%</span>
        </td>
      </tr>`));
  list.innerHTML = `
    <table>
      <thead><tr><th>日付</th><th>モード</th><th class="num">正解/挑戦</th><th>正解率</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

document.getElementById('btn-clear-records').addEventListener('click', () => {
  if (!confirm('すべての記録を消去します。よろしいですか？')) return;
  clearRecords();
  renderRecords();
  renderToday();
});

// ---------- 設定 ----------

const form = document.getElementById('settings-form');

function fillNoteSelect(select) {
  const [lo, hi] = LIMITS.range;
  for (let m = lo; m <= hi; m++) select.add(new Option(midiToName(m), String(m)));
}
fillNoteSelect(form.rangeLow);
fillNoteSelect(form.rangeHigh);

const FORMATS = {
  toleranceCents: (v) => `±${v} セント`,
  holdMs: (v) => `${(v / 1000).toFixed(1)} 秒`,
  timeLimitSec: (v) => `${v} 秒`,
};

function reflectSettings(s) {
  form.rangeLow.value = String(s.rangeLow);
  form.rangeHigh.value = String(s.rangeHigh);
  form.toleranceCents.value = String(s.toleranceCents);
  form.holdMs.value = String(s.holdMs);
  form.timeLimitSec.value = String(s.timeLimitSec);
  form.allowOctave.checked = s.allowOctave;
  for (const [key, fmt] of Object.entries(FORMATS)) {
    form.querySelector(`output[data-for="${key}"]`).textContent = fmt(s[key]);
  }
}

function onFormChange() {
  reflectSettings(updateSettings({
    rangeLow: form.rangeLow.value,
    rangeHigh: form.rangeHigh.value,
    toleranceCents: form.toleranceCents.value,
    holdMs: form.holdMs.value,
    timeLimitSec: form.timeLimitSec.value,
    allowOctave: form.allowOctave.checked,
  }));
}

form.addEventListener('input', onFormChange);
form.addEventListener('change', onFormChange);
document.getElementById('btn-reset-settings').addEventListener('click', () => reflectSettings(resetSettings()));

reflectSettings(getSettings());
renderToday();
