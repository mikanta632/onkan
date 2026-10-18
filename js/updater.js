// アプリの更新
// GitHub Pages はファイルを 10 分ほどキャッシュさせるうえ、ホーム画面から起動すると再読み込みの手段がない。
// そこで公開中の version.js をキャッシュなしで読んで新版を見つけ、全ファイルを取り直してから再読み込みする。

import { APP_VERSION } from './version.js';

// 取り直すファイル。ファイルを追加・改名したらここにも足すこと
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js',
  'js/version.js',
  'js/updater.js',
  'js/audio-engine.js',
  'js/tone-player.js',
  'js/pitch-detector.js',
  'js/pitch-tracker.js',
  'js/note-utils.js',
  'js/judge.js',
  'js/settings.js',
  'js/storage.js',
  'js/modes/mimic.js',
  'js/modes/keyboard-quiz.js',
  'js/modes/relative.js',
  'js/modes/absolute.js',
  'js/keyboard.js',
  'js/trace.js',
  'js/roll.js',
  'js/voice-session.js',
  'js/modes/voice.js',
  'js/modes/phrase.js',
  'js/phrase-bank.js',
];

export { APP_VERSION };

/** 公開中のバージョンを返す。読めなければ例外 */
export async function fetchLatestVersion() {
  const res = await fetch(`js/version.js?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = (await res.text()).match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('バージョンを読み取れません');
  return m[1];
}

/** "1.10.0" > "1.9.0" のように数値として比べる */
export function isNewer(latest, current = APP_VERSION) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

/** 全ファイルをサーバーから取り直してキャッシュを新しくし、ページを読み込み直す */
export async function refreshAndReload(version = String(Date.now())) {
  await Promise.all(ASSETS.map((url) => fetch(url, { cache: 'reload' }).catch(() => {})));
  const url = new URL(location.href);
  url.searchParams.set('v', version);
  location.replace(url.toString());
}
