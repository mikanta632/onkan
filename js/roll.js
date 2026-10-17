// フレーズ練習の表示：お手本の音を横長の帯で、自分の声を線で重ねて描く（カラオケの採点画面のような表示）
// 帯の太さが許容幅（±セント）を表す。

import { midiToName } from './note-utils.js';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createRoll(canvas) {
  const g = canvas.getContext('2d');
  const data = {
    notes: [],      // お手本の音（MIDI 番号）
    noteMs: 900,    // 1 音の長さ
    tolerance: 30,  // 許容幅（セント）
    samples: [],    // { t, slot, c } 記録開始からの時間・何音目か・その音からのずれ
    cursor: null,   // 記録中の現在位置 [ms]
    results: null,  // 判定後の各音の合否 [{ passed }]
  };

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
    const { notes, noteMs, tolerance, samples, cursor, results } = data;
    if (!notes.length) return;

    const lo = Math.min(...notes) - 2;
    const hi = Math.max(...notes) + 2;
    const total = notes.length * noteMs;
    const padX = 8;
    const padY = 14;
    const rowH = (h - padY * 2) / (hi - lo);
    const x = (t) => padX + (t / total) * (w - padX * 2);
    const y = (m) => padY + (hi - Math.max(lo, Math.min(hi, m))) * rowH;

    const colors = {
      line: cssVar('--line'),
      muted: cssVar('--muted'),
      bar: cssVar('--surface-2'),
      ok: cssVar('--ok'),
      okSoft: cssVar('--ok-soft'),
      ng: cssVar('--ng'),
      high: cssVar('--high'),
      low: cssVar('--low'),
      accent: cssVar('--accent'),
    };

    // 半音ごとの横線
    g.strokeStyle = colors.line;
    g.lineWidth = 1;
    for (let m = lo; m <= hi; m++) {
      g.globalAlpha = m % 12 === 0 ? 0.9 : 0.35;
      g.beginPath();
      g.moveTo(0, y(m));
      g.lineTo(w, y(m));
      g.stroke();
    }
    g.globalAlpha = 1;

    // お手本の帯（太さ = 許容幅）
    const barH = Math.max(6, ((tolerance * 2) / 100) * rowH);
    g.font = '600 11px -apple-system, "Hiragino Sans", sans-serif';
    g.textBaseline = 'bottom';
    notes.forEach((m, i) => {
      const x0 = x(i * noteMs) + 2;
      const x1 = x((i + 1) * noteMs) - 2;
      const r = results?.[i];
      g.fillStyle = r ? (r.passed ? colors.okSoft : 'rgba(201, 42, 42, 0.18)') : colors.bar;
      g.strokeStyle = r ? (r.passed ? colors.ok : colors.ng) : colors.muted;
      g.lineWidth = 1.5;
      g.beginPath();
      if (g.roundRect) g.roundRect(x0, y(m) - barH / 2, x1 - x0, barH, Math.min(6, barH / 2));
      else g.rect(x0, y(m) - barH / 2, x1 - x0, barH); // Safari 15 以前
      g.fill();
      g.stroke();
      g.fillStyle = colors.muted;
      g.fillText(midiToName(m), x0 + 2, y(m) - barH / 2 - 1);
    });

    // 自分の声（お手本の音からのずれで描くので、オクターブ違いもその音の高さに重なる）
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (a.c === null || b.c === null) continue;
      g.strokeStyle = Math.abs(b.c) <= tolerance ? colors.ok : b.c > 0 ? colors.high : colors.low;
      g.beginPath();
      g.moveTo(x(a.t), y(notes[a.slot] + a.c / 100));
      g.lineTo(x(b.t), y(notes[b.slot] + b.c / 100));
      g.stroke();
    }

    // 今どこを歌っているか
    if (cursor !== null) {
      g.strokeStyle = colors.accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x(cursor), 0);
      g.lineTo(x(cursor), h);
      g.stroke();
    }
  }

  return {
    /** 表示する内容を一部更新して描き直す */
    set(partial) {
      Object.assign(data, partial);
      draw();
    },
    redraw: draw,
  };
}
