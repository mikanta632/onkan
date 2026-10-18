// フレーズ練習の出題：レベル・ランダム・型・曲の一節
// 音はすべて「ド（長調の主音）からの半音数」で持ち、出題範囲に収まる調へ移してから鳴らす。
// 短調は「ラ」を主音とする（移動ドの短調）。

import { DO_NAMES, pitchClass } from './note-utils.js';

export const KINDS = ['level', 'random', 'pattern', 'song'];
export const KIND_LABELS = { level: 'レベル', random: 'ランダム', pattern: '型', song: '曲' };

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- 階名 ----------

const SOLFA = { ド: 0, レ: 2, ミ: 4, ファ: 5, ソ: 7, ラ: 9, シ: 11 };

/** 「ソ, ド ミ ソ ド'」のような階名の並びを、ドからの半音数にする（, は 1 オクターブ下、' は 1 オクターブ上） */
function solfa(text) {
  return text.trim().split(/\s+/).map((token) => {
    const m = token.match(/^(ド|レ|ミ|ファ|ソ|ラ|シ)([#b]?)([,']*)$/);
    if (!m) throw new Error(`階名を読めません: ${token}`);
    const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    const octave = [...m[3]].reduce((o, c) => o + (c === "'" ? 12 : -12), 0);
    return SOLFA[m[1]] + shift + octave;
  });
}

/** ドからの半音数 → 階名（ド・レ・…・ソ# など） */
export function solfaName(offset) {
  return DO_NAMES[pitchClass(offset)];
}

// ---------- 型（よく出てくる音の動き） ----------

const pattern = (name, tonality, notes) => ({ name, tonality, offsets: solfa(notes) });

const PATTERNS = [
  pattern('音階を3音上がる', 'major', 'ド レ ミ'),
  pattern('音階を3音下がる', 'major', 'ミ レ ド'),
  pattern('主音から5音上がる', 'major', 'ド レ ミ ファ ソ'),
  pattern('5音下がって主音へ', 'major', 'ソ ファ ミ レ ド'),
  pattern('音階を1オクターブ', 'major', "ド レ ミ ファ ソ ラ シ ド'"),
  pattern('主和音を上へ', 'major', 'ド ミ ソ'),
  pattern('主和音を下へ', 'major', 'ソ ミ ド'),
  pattern('主和音とオクターブ', 'major', "ド ミ ソ ド'"),
  pattern('下属和音', 'major', "ファ ラ ド'"),
  pattern('属和音から主音へ', 'major', 'ソ, シ, レ ド'),
  pattern('属七の和音から解決', 'major', 'ソ, シ, レ ファ ミ'),
  pattern('導音から主音へ', 'major', 'ド シ, ド'),
  pattern('下から主音へ', 'major', 'ラ, シ, ド'),
  pattern('4度上がって主音へ', 'major', 'ソ, ド'),
  pattern('5度上がる', 'major', 'ド ソ'),
  pattern('6度上がる', 'major', 'ド ラ'),
  pattern('オクターブ上がる', 'major', "ド ド'"),
  pattern('主音のまわりを回る', 'major', 'ド レ ド シ, ド'),
  pattern('3度ずつ進む', 'major', 'ド ミ レ ファ ミ ソ'),
  pattern('上の主音から下がる', 'major', "ド' シ ラ ソ"),
  pattern('短調の音階を上がる', 'minor', 'ラ, シ, ド レ ミ'),
  pattern('短調の音階を下がる', 'minor', 'ミ レ ド シ, ラ,'),
  pattern('短調の主和音を上へ', 'minor', 'ラ, ド ミ'),
  pattern('短調の主和音を下へ', 'minor', 'ミ ド ラ,'),
  pattern('短調の導音から主音へ', 'minor', 'ラ, ソ#, ラ,'),
  pattern('和声的短音階の上の方', 'minor', 'ミ ファ ソ# ラ'),
  pattern('短調の属和音から主音へ', 'minor', 'ミ, ソ#, シ, ラ,'),
];

// ---------- 曲の一節（作曲者の没後 70 年を過ぎた曲・民謡・古謡のみ。歌詞は載せない） ----------
// durs は 1 拍を 1 とした音の長さ

const song = (title, credit, tonality, notes, durs) => {
  const offsets = solfa(notes);
  if (durs.length !== offsets.length) throw new Error(`音と長さの数が合いません: ${title}`);
  return { name: title, credit, tonality, offsets, durs };
};

const SONGS = [
  song('かえるの合唱', 'ドイツ民謡', 'major', 'ド レ ミ ファ ミ レ ド', [1, 1, 1, 1, 1, 1, 2]),
  song('きらきら星', 'フランス民謡', 'major', 'ド ド ソ ソ ラ ラ ソ', [1, 1, 1, 1, 1, 1, 2]),
  song('ちょうちょう', 'ドイツ民謡', 'major', 'ソ ミ ミ ファ レ レ', [1, 1, 2, 1, 1, 2]),
  song('メリーさんのひつじ', 'アメリカ民謡', 'major', 'ミ レ ド レ ミ ミ ミ', [1.5, 0.5, 1, 1, 1, 1, 2]),
  song('ロンドン橋', 'イギリス民謡', 'major', 'ソ ラ ソ ファ ミ ファ ソ', [1.5, 0.5, 1, 1, 1, 1, 2]),
  song('歓喜の歌', 'ベートーヴェン', 'major', 'ミ ミ ファ ソ ソ ファ ミ レ', [1, 1, 1, 1, 1, 1, 1, 1]),
  song('聖者の行進', 'アメリカ民謡', 'major', 'ド ミ ファ ソ ド ミ ファ ソ', [1, 1, 1, 2, 1, 1, 1, 2]),
  song('家路（新世界より）', 'ドヴォルザーク', 'major', 'ミ ソ ソ ミ レ ド', [1.5, 0.5, 2, 1.5, 0.5, 2]),
  song('ジングルベル', 'ピアポント', 'major', 'ミ ミ ミ ミ ミ ミ ミ ソ ド レ ミ', [1, 1, 2, 1, 1, 2, 1, 1, 1.5, 0.5, 3]),
  song('きよしこの夜', 'グルーバー', 'major', 'ソ ラ ソ ミ ソ ラ ソ ミ', [1.5, 0.5, 1, 3, 1.5, 0.5, 1, 3]),
  song('蛍の光', 'スコットランド民謡', 'major', 'ソ, ド ド ド ミ レ ド レ', [1, 1.5, 0.5, 1, 1, 1.5, 0.5, 1]),
  song('ハッピー・バースデー', 'ヒル姉妹', 'major', 'ソ, ソ, ラ, ソ, ド シ,', [0.75, 0.25, 1, 1, 1, 2]),
  song('ブラームスの子守歌', 'ブラームス', 'major', 'ミ ミ ソ ミ ミ ソ', [0.5, 0.5, 2, 0.5, 0.5, 2]),
  song('ふるさと', '岡野貞一', 'major', 'ド ド ド レ ミ レ ミ ミ ファ ソ', [1, 1, 1, 1.5, 0.5, 1, 1, 1, 1, 3]),
  song('エリーゼのために', 'ベートーヴェン', 'minor', 'ミ レ# ミ レ# ミ シ, レ ド ラ,', [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.5]),
  song('運命', 'ベートーヴェン', 'minor', 'ミ ミ ミ ド レ レ レ シ,', [0.5, 0.5, 0.5, 2, 0.5, 0.5, 0.5, 2]),
  song('荒城の月', '滝廉太郎', 'minor', 'ミ, ミ, ラ, シ, ド シ, ラ,', [1, 1, 1, 1, 1, 1, 2]),
  song('さくらさくら', '日本古謡', 'minor', 'ラ, ラ, シ, ラ, ラ, シ,', [1, 1, 2, 1, 1, 2]),
  song('グリーンスリーブス', 'イギリス民謡', 'minor', 'ラ, ド レ ミ ファ ミ レ シ,', [0.5, 1, 0.5, 0.75, 0.25, 0.5, 1, 0.5]),
];

// ---------- 音階の上を歩いて作るフレーズ（レベル・ランダム） ----------

// 主音からの半音数（長調はド、短調はラが主音）
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const TONIC = { major: 0, minor: -3 }; // 主音のドからの半音数
export const MAX_JUMP = { step: 1, third: 2, fifth: 4, octave: 7 }; // 音階の上で何個先まで跳ぶか

/** 音階の k 番目の音（0 が主音。負なら主音より下）→ ドからの半音数 */
function degree(tonality, k) {
  const s = SCALES[tonality];
  const oct = Math.floor(k / 7);
  return TONIC[tonality] + 12 * oct + s[k - oct * 7];
}

const isChordTone = (k) => [0, 2, 4].includes(((k % 7) + 7) % 7);

/** レベルごとの出題（3 問続けて正解で上がり、3 問続けて外すと下がる） */
export const LEVELS = [
  { tonality: 'major', length: 2, jump: 1, startTonic: true },
  { tonality: 'major', length: 3, jump: 1, startTonic: true },
  { tonality: 'major', length: 3, jump: 2, startTonic: true, endChord: true },
  { tonality: 'major', length: 4, jump: 1 },
  { tonality: 'major', length: 4, jump: 2, endChord: true },
  { tonality: 'minor', length: 3, jump: 2, startTonic: true },
  { tonality: 'major', length: 5, jump: 2, endChord: true },
  { tonality: 'major', length: 4, jump: 4 },
  { tonality: 'minor', length: 5, jump: 2, endChord: true },
  { tonality: 'both', length: 6, jump: 4, endChord: true },
  { tonality: 'both', length: 6, jump: 7 },
  { tonality: 'both', length: 8, jump: 4 },
];

const JUMP_LABELS = { 1: '隣の音', 2: '3度まで', 4: '5度まで', 7: '8度まで' };
const TONALITY_LABELS = { major: '長調', minor: '短調', both: '長調・短調' };

export function levelLabel(n) {
  const l = LEVELS[n - 1];
  const parts = [TONALITY_LABELS[l.tonality], `${l.length}音`, JUMP_LABELS[l.jump]];
  if (l.startTonic) parts.push('主音から');
  return parts.join('・');
}

/**
 * 苦手な音程ほど選ばれやすくする重み。
 * @param {Record<string, {n: number, ok: number}>|null} stats 音程（半音数・符号つき）ごとの成績
 */
function weightOf(stats, semis) {
  if (!stats) return 1;
  const r = stats[String(semis)];
  const miss = r ? (r.n - r.ok + 1) / (r.n + 2) : 0.5; // 記録が少ないうちは 0.5 に寄せる
  return 0.3 + 1.5 * miss;
}

function weightedPick(options) {
  const total = options.reduce((s, o) => s + o.w, 0);
  let x = Math.random() * total;
  for (const o of options) {
    x -= o.w;
    if (x <= 0) return o;
  }
  return options[options.length - 1];
}

/**
 * 音階の上を跳び跳びに歩いてフレーズを作る
 * @param {{tonality: string, length: number, jump: number, startTonic?: boolean, endChord?: boolean}} p
 * @param {number} spanLimit フレーズ全体の幅の上限（半音）
 */
function walk(p, spanLimit, stats) {
  const tonality = p.tonality === 'both' ? pick(['major', 'minor']) : p.tonality;
  let ks = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    ks = [p.startTonic ? 0 : pick([-3, -2, -1, 0, 1, 2, 3, 4])];
    let lo = degree(tonality, ks[0]);
    let hi = lo;
    for (let i = 1; i < p.length; i++) {
      const k = ks[i - 1];
      const options = [];
      for (let d = -p.jump; d <= p.jump; d++) {
        if (d === 0) continue;
        const m = degree(tonality, k + d);
        if (Math.max(hi, m) - Math.min(lo, m) > spanLimit) continue;
        options.push({ d, w: weightOf(stats, m - degree(tonality, k)) });
      }
      if (!options.length) break;
      const next = k + weightedPick(options).d;
      ks.push(next);
      lo = Math.min(lo, degree(tonality, next));
      hi = Math.max(hi, degree(tonality, next));
    }
    if (ks.length === p.length && (!p.endChord || isChordTone(ks[ks.length - 1]))) break;
  }
  return { tonality, offsets: ks.map((k) => degree(tonality, k)) };
}

// ---------- 調を決める ----------

/** フレーズが出題範囲に収まるようにドの高さ（MIDI 番号）を決める。収まらなければはみ出しが最も小さい調 */
function fitKey(offsets, lo, hi) {
  const min = Math.min(...offsets);
  const max = Math.max(...offsets);
  const fits = [];
  let best = [];
  let bestOver = Infinity;
  for (let doMidi = lo - max - 12; doMidi <= hi - min + 12; doMidi++) {
    const over = Math.max(0, lo - (min + doMidi)) + Math.max(0, max + doMidi - hi);
    if (over === 0) fits.push(doMidi);
    if (over < bestOver) {
      bestOver = over;
      best = [doMidi];
    } else if (over === bestOver) {
      best.push(doMidi);
    }
  }
  return pick(fits.length ? fits : best);
}

/** 主和音（長調はドミソ、短調はラドミ）を、フレーズの真ん中に近い高さで返す */
export function tonicChord(q) {
  const triad = q.tonality === 'minor' ? [-3, 0, 4] : [0, 4, 7];
  const center = (Math.min(...q.notes) + Math.max(...q.notes)) / 2;
  const base = q.doMidi + triad[1];
  const shift = 12 * Math.round((center - base) / 12);
  return triad.map((o) => q.doMidi + o + shift);
}

// ---------- 出題 ----------

/**
 * @param {string} kind level / random / pattern / song
 * @param {object} s 設定
 * @param {{ level?: number, stats?: object|null, previous?: object|null }} ctx
 * @returns {{ kind: string, notes: number[], offsets: number[], durs: number[], doMidi: number,
 *   tonality: 'major'|'minor', name: string|null, credit: string|null }}
 */
export function makeQuestion(kind, s, { level = 1, stats = null, previous = null } = {}) {
  const span = Math.max(s.rangeHigh - s.rangeLow, 7);
  let q;
  for (let attempt = 0; attempt < 10; attempt++) {
    let base;
    if (kind === 'pattern' || kind === 'song') {
      const list = (kind === 'song' ? SONGS : PATTERNS)
        .filter((x) => s.phraseScale === 'both' || x.tonality === s.phraseScale);
      base = pick(list.length ? list : kind === 'song' ? SONGS : PATTERNS);
    } else {
      const p = kind === 'level'
        ? LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1]
        : { tonality: s.phraseScale, length: s.phraseLength, jump: MAX_JUMP[s.phraseStep] };
      base = walk(p, Math.max(span, p.jump >= 7 ? 12 : 0), s.phraseFocusWeak ? stats : null);
    }
    const doMidi = fitKey(base.offsets, s.rangeLow, s.rangeHigh);
    q = {
      kind,
      offsets: base.offsets,
      durs: base.durs ?? base.offsets.map(() => 1),
      doMidi,
      notes: base.offsets.map((o) => o + doMidi),
      tonality: base.tonality,
      name: base.name ?? null,
      credit: base.credit ?? null,
    };
    // 同じ問題が続かないように（型・曲は同じものを、それ以外は同じ音の並びを避ける）
    const same = previous && (q.name ? q.name === previous.name : q.notes.join() === previous.notes.join());
    if (!same) break;
  }
  return q;
}
