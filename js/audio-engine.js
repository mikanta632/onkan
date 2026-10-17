// AudioContext とマイク入力の管理
// iOS Safari では、AudioContext の開始とマイクの許可要求をユーザーのタップの中で行う必要がある。
// ensureAudio() / preparePlayback() はタップのハンドラから「最初に・同期的に」呼ぶこと。
//
// iOS ではマイクを使っている間、Web Audio の音が受話口に回ったり極端に小さくなったりする。
// そこでお手本を鳴らすときはマイクを手放して「再生専用」にし、鳴らし終えてからマイクを取り直す。

let ctx = null;
let input = null;      // マイクを差し替えても変わらない入力ノード
let micStream = null;
let micSource = null;

export function isAudioSupported() {
  return Boolean(
    (window.AudioContext || window.webkitAudioContext) &&
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
    window.isSecureContext
  );
}

/** Safari 16.4+ の Audio Session API。"playback" なら消音スイッチがオンでも鳴る */
function setSessionType(type) {
  if (!navigator.audioSession) return;
  try { navigator.audioSession.type = type; } catch { /* 非対応なら無視 */ }
}

export function getSessionType() {
  return navigator.audioSession ? navigator.audioSession.type : null;
}

function getContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    input = ctx.createGain();
  }
  return ctx;
}

function resumeContext(c) {
  if (c.state === 'running') return Promise.resolve();
  return c.resume().catch(() => { /* タップ外では失敗することがある。次のタップで再挑戦する */ });
}

function micIsLive() {
  return Boolean(micStream && micStream.getAudioTracks().some((t) => t.readyState === 'live'));
}

async function openMic(c) {
  setSessionType('play-and-record');
  // エコー除去・ノイズ抑制・自動音量調整は音高を歪めるので切る
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  releaseMic();
  micStream = stream;
  micSource = c.createMediaStreamSource(stream);
  micSource.connect(input);
}

/**
 * AudioContext を動かし、マイクの許可をとってつなぐ。最初のタップで呼ぶ。
 * @returns {Promise<{ctx: AudioContext, input: AudioNode}>}
 */
export async function ensureAudio() {
  const c = getContext();
  // resume と getUserMedia はどちらもタップ中に呼び出しておき、完了は後で待つ
  const resumed = resumeContext(c);
  const mic = micIsLive() ? null : openMic(c);
  await Promise.all([resumed, mic]);
  return { ctx: c, input };
}

/** マイクを手放す（お手本の再生前、他の画面へ移ったときなど） */
export function releaseMic() {
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

/** マイクが切れていればつなぎ直す。許可済みなのでタップの外から呼んでよい */
export async function reopenMic() {
  const c = getContext();
  if (!micIsLive()) await openMic(c);
  await resumeContext(c);
}

/**
 * お手本を鳴らす準備：マイクを手放し、再生専用にして AudioContext を動かす。
 * resume をタップ中に呼ぶため、ハンドラの中で await より前に呼ぶこと。
 * @returns {Promise<AudioContext>}
 */
export async function preparePlayback() {
  const c = getContext();
  releaseMic();
  setSessionType('playback');
  await resumeContext(c);
  return c;
}
