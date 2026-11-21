(() => {
  'use strict';

  // ---- 形状定数 (ホイール半径を 1 とした正規化座標, y は下向き) ----
  const RING_INNER = 0.84;   // 色相環の内径 (外径は 1)
  const SHAPE_R = 0.78;      // 内側ピッカーの外接円半径
  const RING_MID = (RING_INNER + 1) / 2;
  const SQRT3 = Math.sqrt(3);
  const SQ_HALF = SHAPE_R / Math.SQRT2;  // 正方形の半辺

  // ---- 状態 ----
  // h: 0-360。sv/v (HSV) と sl/l (HSL) を両方保持し、
  // 無彩色・黒・白など一方が縮退しても他方の彩度を失わないようにする。
  const state = { mode: 'hsv', h: 0, sv: 1, v: 1, sl: 1, l: 0.5 };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // ---- 色変換 ----
  function hsvToRgb(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  // 縮退時 (彩度が定義できない時) は s: null を返す
  function hsvToHsl(s, v) {
    const l = v * (1 - s / 2);
    const m = Math.min(l, 1 - l);
    return { s: m === 0 ? null : (v - l) / m, l };
  }

  function hslToHsv(s, l) {
    const v = l + s * Math.min(l, 1 - l);
    return { s: v === 0 ? null : 2 * (1 - l / v), v };
  }

  const toHex = (rgb) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

  function parseHex(str) {
    let s = str.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }

  // ---- 状態更新 ----
  function setHsv(s, v) {
    state.sv = s; state.v = v;
    const r = hsvToHsl(s, v);
    state.l = r.l;
    if (r.s !== null) state.sl = clamp(r.s, 0, 1);
  }

  function setHsl(s, l) {
    state.sl = s; state.l = l;
    const r = hslToHsv(s, l);
    state.v = r.v;
    if (r.s !== null) state.sv = clamp(r.s, 0, 1);
  }

  function setRgb(rgb) {
    const n = rgbToHsv(...rgb);
    if (n.s !== 0) state.h = n.h;            // 無彩色なら色相を保持
    setHsv(n.v === 0 ? state.sv : n.s, n.v); // 黒なら彩度を保持
  }

  // 現在のモデルでの (彩度, 明度/輝度)
  const getST = () => (state.mode === 'hsv'
    ? { s: state.sv, t: state.v }
    : { s: state.sl, t: state.l });

  const setST = (s, t) => (state.mode === 'hsv' ? setHsv(s, t) : setHsl(s, t));

  // ---- ジオメトリ ----
  // HSV: 正方形。横 = S, 縦 = V。
  // HSL: 正三角形。頂点 = 純色(右), 白(左上), 黒(左下)。
  //      縦 = L, 横 = 彩度の実量 C = S * (1 - |2L - 1|) で、HSL 双円錐の断面に一致する。
  const maxChroma = (l) => 1 - Math.abs(2 * l - 1);

  function stToPoint(s, t, mode) {
    if (mode === 'hsv') {
      return { x: -SQ_HALF + 2 * SQ_HALF * s, y: SQ_HALF - 2 * SQ_HALF * t };
    }
    const r = SHAPE_R;
    return { x: -r / 2 + 1.5 * r * s * maxChroma(t), y: r * SQRT3 / 2 - t * r * SQRT3 };
  }

  function pointToST(x, y, mode, prevS) {
    if (mode === 'hsv') {
      return {
        s: clamp((x + SQ_HALF) / (2 * SQ_HALF), 0, 1),
        t: clamp((SQ_HALF - y) / (2 * SQ_HALF), 0, 1),
      };
    }
    const r = SHAPE_R;
    const t = clamp((r * SQRT3 / 2 - y) / (r * SQRT3), 0, 1);
    const mc = maxChroma(t);
    const c = clamp((x + r / 2) / (1.5 * r), 0, mc);
    return { s: mc > 0 ? c / mc : prevS, t };
  }

  // 色相 0 を上にとり時計回り
  const hueToPoint = (h, rad) => {
    const a = (h * Math.PI) / 180;
    return { x: Math.sin(a) * rad, y: -Math.cos(a) * rad };
  };
  const pointToHue = (x, y) => ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const wheel = $('wheel');
  const ringCanvas = $('ring-canvas'), shapeCanvas = $('shape-canvas');
  const ringCtx = ringCanvas.getContext('2d');
  const shapeCtx = shapeCanvas.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');
  const hueThumb = $('hue-thumb'), shapeThumb = $('shape-thumb');
  const swatch = $('swatch');
  const legend = $('model-legend'), labelT = $('label-t');
  const modeButtons = document.querySelectorAll('.mode-toggle button');
  const inputs = {
    h: $('in-h'), s: $('in-s'), t: $('in-t'),
    r: $('in-r'), g: $('in-g'), b: $('in-b'),
    hex: $('in-hex'),
  };
  const toast = $('toast');

  // ---- Canvas 描画 ----
  // ImageData で画素ごとに色を計算し、パスでクリップして描くことで縁をアンチエイリアスする
  function blitClipped(ctx, img, x0, y0, pathFn) {
    off.width = img.width; off.height = img.height;
    offCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath();
    pathFn(ctx);
    ctx.clip('evenodd');
    ctx.drawImage(off, x0, y0);
    ctx.restore();
  }

  function drawRing() {
    const N = ringCanvas.width;
    if (!N) return;
    const R = N / 2;
    const img = ringCtx.createImageData(N, N);
    const d = img.data;
    const lo = RING_INNER - 4 / R, hi = 1 + 4 / R;
    for (let j = 0; j < N; j++) {
      const y = (j + 0.5 - R) / R;
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5 - R) / R;
        const dist = Math.hypot(x, y);
        if (dist < lo || dist > hi) continue;
        const [r, g, b] = hsvToRgb(pointToHue(x, y), 1, 1);
        const o = (j * N + i) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ringCtx.clearRect(0, 0, N, N);
    blitClipped(ringCtx, img, 0, 0, (c) => {
      c.arc(R, R, R - 1, 0, Math.PI * 2);
      c.arc(R, R, R * RING_INNER, 0, Math.PI * 2);
    });
  }

  const drawn = { h: null, mode: null, n: 0 };

  function drawShape() {
    const N = shapeCanvas.width;
    if (!N) return;
    const R = N / 2;
    const isHsv = state.mode === 'hsv';
    const r = SHAPE_R;
    const [br, bg, bb] = hsvToRgb(state.h, 1, 1);

    const bx0 = isHsv ? -SQ_HALF : -r / 2, bx1 = isHsv ? SQ_HALF : r;
    const by1 = isHsv ? SQ_HALF : (r * SQRT3) / 2, by0 = -by1;
    const px0 = Math.max(0, Math.floor(R + bx0 * R) - 2);
    const py0 = Math.max(0, Math.floor(R + by0 * R) - 2);
    const px1 = Math.min(N, Math.ceil(R + bx1 * R) + 2);
    const py1 = Math.min(N, Math.ceil(R + by1 * R) + 2);
    const w = px1 - px0, hgt = py1 - py0;

    const img = shapeCtx.createImageData(w, hgt);
    const d = img.data;
    for (let j = 0; j < hgt; j++) {
      const y = (py0 + j + 0.5 - R) / R;
      for (let i = 0; i < w; i++) {
        const x = (px0 + i + 0.5 - R) / R;
        let cr, cg, cb;
        if (isHsv) {
          const s = clamp((x + SQ_HALF) / (2 * SQ_HALF), 0, 1);
          const v = clamp((SQ_HALF - y) / (2 * SQ_HALF), 0, 1);
          cr = v * (255 - s * (255 - br));
          cg = v * (255 - s * (255 - bg));
          cb = v * (255 - s * (255 - bb));
        } else {
          // 頂点色 (純色・白・黒) の線形補間と HSL の定義は一致する
          const l = clamp((r * SQRT3 / 2 - y) / (r * SQRT3), 0, 1);
          const c = clamp((x + r / 2) / (1.5 * r), 0, maxChroma(l));
          const w0 = (l - c / 2) * 255;
          cr = w0 + c * br; cg = w0 + c * bg; cb = w0 + c * bb;
        }
        const o = (j * w + i) * 4;
        d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255;
      }
    }

    shapeCtx.clearRect(0, 0, N, N);
    blitClipped(shapeCtx, img, px0, py0, (c) => {
      if (isHsv) {
        c.rect(R - SQ_HALF * R, R - SQ_HALF * R, 2 * SQ_HALF * R, 2 * SQ_HALF * R);
      } else {
        c.moveTo(R + r * R, R);
        c.lineTo(R - (r / 2) * R, R - (r * SQRT3 / 2) * R);
        c.lineTo(R - (r / 2) * R, R + (r * SQRT3 / 2) * R);
        c.closePath();
      }
    });

    drawn.h = state.h; drawn.mode = state.mode; drawn.n = N;
  }

  let rafId = 0;
  function scheduleDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (drawn.h !== state.h || drawn.mode !== state.mode || drawn.n !== shapeCanvas.width) {
        drawShape();
      }
    });
  }

  function resizeCanvases() {
    const N = Math.round(wheel.clientWidth * (window.devicePixelRatio || 1));
    if (!N || N === ringCanvas.width) return;
    ringCanvas.width = ringCanvas.height = N;
    shapeCanvas.width = shapeCanvas.height = N;
    drawRing();
    drawShape();
  }

  // ---- UI 更新 ----
  const placeAt = (el, p) => {
    el.style.left = `${50 + p.x * 50}%`;
    el.style.top = `${50 + p.y * 50}%`;
  };

  // skip: 入力中のフィールドは上書きしない
  function render(skip) {
    const isHsv = state.mode === 'hsv';
    const rgb = hsvToRgb(state.h, state.sv, state.v);
    const hex = toHex(rgb);
    const st = getST();

    placeAt(hueThumb, hueToPoint(state.h, RING_MID));
    hueThumb.style.backgroundColor = `hsl(${state.h}, 100%, 50%)`;
    placeAt(shapeThumb, stToPoint(st.s, st.t, state.mode));
    shapeThumb.style.backgroundColor = hex;
    swatch.style.backgroundColor = hex;

    legend.textContent = isHsv ? 'HSV' : 'HSL';
    labelT.textContent = isHsv ? 'V' : 'L';
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));

    const values = {
      h: Math.round(state.h), s: Math.round(st.s * 100), t: Math.round(st.t * 100),
      r: rgb[0], g: rgb[1], b: rgb[2],
      hex,
    };
    for (const key in inputs) {
      if (key === skip) continue;
      inputs[key].value = values[key];
      inputs[key].classList.remove('invalid');
    }

    hueThumb.setAttribute('aria-valuenow', values.h);
    shapeThumb.setAttribute('aria-label', isHsv ? '彩度と明度' : '彩度と輝度');
    shapeThumb.setAttribute('aria-valuetext',
      `彩度 ${values.s}%、${isHsv ? '明度' : '輝度'} ${values.t}%`);

    scheduleDraw();
    updateHash(hex);
  }

  // ---- URLハッシュで色を共有 (#RRGGBB) ----
  let hashTimer = 0;
  function updateHash(hex) {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      history.replaceState(null, '', '#' + hex.slice(1));
    }, 200);
  }

  function loadFromHash() {
    const rgb = parseHex(location.hash);
    if (!rgb) return false;
    setRgb(rgb);
    return true;
  }

  // ---- モード切替 (選択はブラウザに記憶) ----
  const MODE_KEY = 'color-picker-mode';
  function setMode(mode) {
    state.mode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* 保存できなくても動作に影響なし */ }
    render();
  }
  modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // ---- ポインタ操作 ----
  let dragTarget = null;

  function toNormalized(e) {
    const rect = wheel.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
    };
  }

  function applyDrag(p) {
    if (dragTarget === 'hue') {
      state.h = pointToHue(p.x, p.y);
    } else {
      const st = pointToST(p.x, p.y, state.mode, getST().s);
      setST(st.s, st.t);
    }
    render();
  }

  wheel.addEventListener('pointerdown', (e) => {
    const p = toNormalized(e);
    const dist = Math.hypot(p.x, p.y);
    if (dist > 1.05) return; // 円の外 (四隅) は無視
    dragTarget = dist >= (RING_INNER + SHAPE_R) / 2 ? 'hue' : 'shape';
    wheel.setPointerCapture(e.pointerId);
    (dragTarget === 'hue' ? hueThumb : shapeThumb).focus({ preventScroll: true });
    applyDrag(p);
    e.preventDefault();
  });

  wheel.addEventListener('pointermove', (e) => {
    if (dragTarget && wheel.hasPointerCapture(e.pointerId)) applyDrag(toNormalized(e));
  });

  const endDrag = () => { dragTarget = null; };
  wheel.addEventListener('pointerup', endDrag);
  wheel.addEventListener('pointercancel', endDrag);

  // ---- キーボード操作 (Shiftで10倍) ----
  hueThumb.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
    else return;
    state.h = (((Math.round(state.h) + d) % 360) + 360) % 360;
    render();
    e.preventDefault();
  });

  shapeThumb.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 10 : 1) / 100;
    let { s, t } = getST();
    if (e.key === 'ArrowRight') s += step;
    else if (e.key === 'ArrowLeft') s -= step;
    else if (e.key === 'ArrowUp') t += step;
    else if (e.key === 'ArrowDown') t -= step;
    else return;
    setST(clamp(s, 0, 1), clamp(t, 0, 1));
    render();
    e.preventDefault();
  });

  // ---- 数値入力 ----
  function readNum(key, max) {
    const el = inputs[key];
    const n = Number(el.value);
    const ok = el.value !== '' && Number.isFinite(n) && n >= 0 && n <= max;
    el.classList.toggle('invalid', !ok);
    return ok ? n : null;
  }

  inputs.h.addEventListener('input', () => {
    const n = readNum('h', 360);
    if (n === null) return;
    state.h = n;
    render('h');
  });

  ['s', 't'].forEach((key) => {
    inputs[key].addEventListener('input', () => {
      const n = readNum(key, 100);
      if (n === null) return;
      const st = getST();
      st[key] = n / 100;
      setST(st.s, st.t);
      render(key);
    });
  });

  ['r', 'g', 'b'].forEach((key) => {
    inputs[key].addEventListener('input', () => {
      const vals = ['r', 'g', 'b'].map((k) => readNum(k, 255));
      if (vals.includes(null)) return;
      setRgb(vals);
      render(key);
    });
  });

  inputs.hex.addEventListener('input', () => {
    const rgb = parseHex(inputs.hex.value);
    inputs.hex.classList.toggle('invalid', !rgb);
    if (!rgb) return;
    setRgb(rgb);
    render('hex');
  });

  // フォーカスが外れたら表示を正規化
  Object.values(inputs).forEach((el) => el.addEventListener('blur', () => render()));

  // ---- コピー ----
  let toastTimer = 0;
  function showToast(msg) {
    toast.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.textContent = ''; }, 1500);
  }

  $('copy').addEventListener('click', async () => {
    const hex = inputs.hex.value;
    try {
      await navigator.clipboard.writeText(hex);
      showToast(`${hex} をコピーしました`);
    } catch {
      inputs.hex.select();
      showToast('コピーできませんでした（手動でコピーしてください）');
    }
  });

  window.addEventListener('hashchange', () => { if (loadFromHash()) render(); });

  // ---- 初期化 ----
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'hsv' || saved === 'hsl') state.mode = saved;
  } catch { /* 読めなければ既定の HSV */ }

  state.h = 210;
  if (!loadFromHash()) setHsv(0.8, 0.9);

  new ResizeObserver(resizeCanvases).observe(wheel);
  window.addEventListener('resize', resizeCanvases); // ズーム等による devicePixelRatio 変化
  render();
})();
