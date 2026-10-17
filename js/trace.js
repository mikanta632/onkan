// 発声練習で記録した音程の変化を描くグラフ
// 横軸は記録時間、縦軸はお手本からのずれ（±100 セントで頭打ち）。緑の帯が許容幅。

const RANGE = 100;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createTrace(canvas) {
  const g = canvas.getContext('2d');
  let points = [];
  let duration = 2000;
  let tolerance = 30;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const pad = 4;
    const x = (t) => pad + (t / duration) * (w - pad * 2);
    const y = (c) => h / 2 - (Math.max(-RANGE, Math.min(RANGE, c)) / RANGE) * (h / 2 - pad);

    // 許容幅の帯と中心線
    g.fillStyle = cssVar('--ok-soft');
    g.fillRect(0, y(tolerance), w, y(-tolerance) - y(tolerance));
    g.strokeStyle = cssVar('--muted');
    g.globalAlpha = 0.5;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.globalAlpha = 1;

    // 記録した音程（途切れたところは線を切る）
    g.lineWidth = 3;
    g.lineCap = 'round';
    const colors = { ok: cssVar('--ok'), high: cssVar('--high'), low: cssVar('--low') };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a.c === null || b.c === null) continue;
      g.strokeStyle = Math.abs(b.c) <= tolerance ? colors.ok : b.c > 0 ? colors.high : colors.low;
      g.beginPath();
      g.moveTo(x(a.t), y(a.c));
      g.lineTo(x(b.t), y(b.c));
      g.stroke();
    }
  }

  return {
    /** 新しい記録を始める */
    reset(durationMs, toleranceCents) {
      duration = durationMs;
      tolerance = toleranceCents;
      points = [];
      draw();
    },
    /** @param {number} t 記録開始からの時間 [ms] @param {number|null} cents */
    push(t, cents) {
      points.push({ t, c: cents });
      draw();
    },
    redraw: draw,
  };
}
