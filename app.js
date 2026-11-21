(() => {
  'use strict';

  // ---- 状態: h 0-360, s 0-1, v 0-1 ----
  const state = { h: 0, s: 1, v: 1 };

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

  const toHex = (rgb) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

  function parseHex(str) {
    let s = str.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const sv = $('sv'), svThumb = $('sv-thumb');
  const hue = $('hue'), hueThumb = $('hue-thumb');
  const swatch = $('swatch');
  const inputs = {
    h: $('in-h'), s: $('in-s'), v: $('in-v'),
    r: $('in-r'), g: $('in-g'), b: $('in-b'),
    hex: $('in-hex'),
  };
  const toast = $('toast');

  // ---- 描画 ----
  // skip: 入力中のフィールドは上書きしない
  function render(skip) {
    const { h, s, v } = state;
    const rgb = hsvToRgb(h, s, v);
    const hex = toHex(rgb);

    sv.style.backgroundColor = `hsl(${h}, 100%, 50%)`;
    svThumb.style.left = `${s * 100}%`;
    svThumb.style.top = `${(1 - v) * 100}%`;
    svThumb.style.backgroundColor = hex;
    hueThumb.style.left = `${(h / 360) * 100}%`;
    hueThumb.style.backgroundColor = `hsl(${h}, 100%, 50%)`;
    swatch.style.backgroundColor = hex;

    const values = {
      h: Math.round(h), s: Math.round(s * 100), v: Math.round(v * 100),
      r: rgb[0], g: rgb[1], b: rgb[2],
      hex,
    };
    for (const key in inputs) {
      if (key === skip) continue;
      inputs[key].value = values[key];
      inputs[key].classList.remove('invalid');
    }

    hue.setAttribute('aria-valuenow', values.h);
    sv.setAttribute('aria-valuetext', `彩度 ${values.s}%、明度 ${values.v}%`);

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
    Object.assign(state, rgbToHsv(...rgb));
    return true;
  }

  // ---- ドラッグ操作 ----
  function makeDraggable(el, onMove) {
    const handle = (e) => {
      const rect = el.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      onMove(x, y);
      render();
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      el.focus();
      handle(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (el.hasPointerCapture(e.pointerId)) handle(e);
    });
  }

  makeDraggable(sv, (x, y) => { state.s = x; state.v = 1 - y; });
  makeDraggable(hue, (x) => { state.h = x * 360; });

  // ---- キーボード操作 (Shiftで10倍) ----
  sv.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 10 : 1) / 100;
    const map = {
      ArrowLeft: ['s', -step], ArrowRight: ['s', step],
      ArrowDown: ['v', -step], ArrowUp: ['v', step],
    };
    const m = map[e.key];
    if (!m) return;
    state[m[0]] = clamp(state[m[0]] + m[1], 0, 1);
    render();
    e.preventDefault();
  });

  hue.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    let d = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
    else if (e.key === 'Home') { state.h = 0; render(); e.preventDefault(); return; }
    else if (e.key === 'End') { state.h = 360; render(); e.preventDefault(); return; }
    else return;
    state.h = clamp(state.h + d, 0, 360);
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

  ['h', 's', 'v'].forEach((key) => {
    inputs[key].addEventListener('input', () => {
      const n = readNum(key, key === 'h' ? 360 : 100);
      if (n === null) return;
      state[key] = key === 'h' ? n : n / 100;
      render(key);
    });
  });

  ['r', 'g', 'b'].forEach((key) => {
    inputs[key].addEventListener('input', () => {
      const vals = ['r', 'g', 'b'].map((k) => readNum(k, 255));
      if (vals.includes(null)) return;
      const next = rgbToHsv(...vals);
      // 無彩色のときは色相を保持し、黒のときは彩度も保持する
      if (next.s === 0) next.h = state.h;
      if (next.v === 0) next.s = state.s;
      Object.assign(state, next);
      render(key);
    });
  });

  inputs.hex.addEventListener('input', () => {
    const rgb = parseHex(inputs.hex.value);
    inputs.hex.classList.toggle('invalid', !rgb);
    if (!rgb) return;
    const next = rgbToHsv(...rgb);
    if (next.s === 0) next.h = state.h;
    if (next.v === 0) next.s = state.s;
    Object.assign(state, next);
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
  if (!loadFromHash()) Object.assign(state, { h: 210, s: 0.8, v: 0.9 });
  render();
})();
