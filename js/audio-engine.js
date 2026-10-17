// AudioContext とマイク入力の管理
// iOS Safari では、AudioContext の開始とマイクの許可要求をユーザーのタップの中で行う必要がある。
// ensureAudio() はタップのハンドラから「最初に・同期的に」呼ぶこと。

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

function getContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    input = ctx.createGain();
  }
  return ctx;
}

function micIsLive() {
  return Boolean(micStream && micStream.getAudioTracks().some((t) => t.readyState === 'live'));
}

async function openMic(c) {
  // Safari 16.4+：録音と再生を同時に行うセッションにする
  if (navigator.audioSession) {
    try { navigator.audioSession.type = 'play-and-record'; } catch { /* 非対応なら無視 */ }
  }
  // エコー除去・ノイズ抑制・自動音量調整は音高を歪めるので切る
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  if (micSource) micSource.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = stream;
  micSource = c.createMediaStreamSource(stream);
  micSource.connect(input);
}

/**
 * AudioContext を動かし、マイクをつなぐ。すでに準備済みなら何もしない。
 * バックグラウンド復帰でマイクが切れていた場合は取り直す。
 * @returns {Promise<{ctx: AudioContext, input: AudioNode}>}
 */
export async function ensureAudio() {
  const c = getContext();
  // resume と getUserMedia はどちらもタップ中に呼び出しておき、完了は後で待つ
  const resumed = c.state === 'running' ? Promise.resolve() : c.resume();
  const mic = micIsLive() ? Promise.resolve() : openMic(c);
  await Promise.all([resumed, mic]);
  return { ctx: c, input };
}
