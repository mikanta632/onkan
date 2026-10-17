// 周波数・MIDI 番号・音名・セントの相互変換

export const A4_FREQ = 440;
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 周波数 → MIDI 番号（小数を含む。A4 = 69） */
export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / A4_FREQ);
}

/** MIDI 番号 → 周波数 */
export function midiToFreq(midi) {
  return A4_FREQ * 2 ** ((midi - 69) / 12);
}

/** MIDI 番号 → 音名（例: 64 → "E4"）。小数は最も近い半音に丸める */
export function midiToName(midi) {
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

/** ref から見た freq のずれ（セント）。正なら高い */
export function centsBetween(freq, refFreq) {
  return 1200 * Math.log2(freq / refFreq);
}

/** オクターブ違いを無視したずれ（-600〜+600 セントに折りたたむ） */
export function foldOctave(cents) {
  return cents - 1200 * Math.round(cents / 1200);
}
