(() => {
  'use strict';

  // ---- 形状定数 (ホイール半径を 1 とした正規化座標, y は下向き) ----
  const RING_INNER = 0.84;   // 色相環の内径 (外径は 1)
  const SHAPE_R = 0.78;      // 内側ピッカーの外接円半径
  const DISK_R = 0.97;       // OKLCH 円盤の半径
  const RING_MID = (RING_INNER + 1) / 2;
  const SQRT3 = Math.sqrt(3);
  const SQ_HALF = SHAPE_R / Math.SQRT2;  // 正方形の半辺

  // ---- 状態 ----
  // HSV (h, sv, v) / HSL (h, sl, l) / 相対OKLCH (okL, okC, okH) をすべて保持し、
  // 無彩色・黒・白など一方が縮退しても他方の彩度や色相を失わないようにする。
  // okC は「その色相・Lightness で sRGB 内に取り得る最大 Chroma」に対する割合 (0-1)。
  const state = {
    mode: 'hsv',
    h: 0, sv: 1, v: 1, sl: 1, l: 0.5,
    okL: 0.6, okC: 1, okH: 0,
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const DEG = Math.PI / 180;
  const wrapHue = (h) => ((h % 360) + 360) % 360;

  // ---- 色変換: HSV / HSL (rgb は 0-1 の浮動小数) ----
  function hsvToRgbF(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
  }
  const to255 = (rgb) => rgb.map((x) => Math.round(clamp(x, 0, 1) * 255));
  const hsvToRgb = (h, s, v) => to255(hsvToRgbF(h, s, v));

  function rgbToHsv(r, g, b) {
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

  // ---- 色変換: OKLab / OKLCH (Björn Ottosson による定義) ----
  const srgbToLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const linearToSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

  function oklabToLinear(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }

  function linearToOklab(r, g, b) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }

  function rgbToOklch(rgb) {
    const [L, a, b] = linearToOklab(...rgb.map(srgbToLinear));
    return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) / DEG) + 360) % 360 };
  }

  function oklchToRgbF(L, C, h) {
    const lin = oklabToLinear(L, C * Math.cos(h * DEG), C * Math.sin(h * DEG));
    return lin.map((x) => linearToSrgb(clamp(x, 0, 1)));
  }

  const GAMUT_EPS = 1e-7;
  function inGamut(L, a, b) {
    const lin = oklabToLinear(L, a, b);
    return lin.every((x) => x >= -GAMUT_EPS && x <= 1 + GAMUT_EPS);
  }

  // OKLab → 線形 sRGB の行列 (oklabToLinear と同じ係数)
  const LMS_FROM_AB = [
    [0.3963377774, 0.2158037573],
    [-0.1055613458, -0.0638541728],
    [-0.0894841775, -1.2914855480],
  ];
  const RGB_FROM_LMS = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.7076147010],
  ];
  const C_SEARCH_MAX = 0.5; // sRGB の最大 Chroma は約 0.32

  // 3 次式 c0 + c1 x + c2 x^2 + c3 x^3 の [0, xmax] 内の実根
  function cubicRoots(c0, c1, c2, c3, xmax) {
    const f = (x) => c0 + x * (c1 + x * (c2 + x * c3));
    // 極値で区間を分割すると各区間で単調になり、根は高々 1 つ
    const cuts = [0, xmax];
    const A = 3 * c3, B = 2 * c2, C = c1;
    if (Math.abs(A) > 1e-12) {
      const disc = B * B - 4 * A * C;
      if (disc > 0) {
        const sq = Math.sqrt(disc);
        cuts.push((-B - sq) / (2 * A), (-B + sq) / (2 * A));
      }
    } else if (Math.abs(B) > 1e-12) {
      cuts.push(-C / B);
    }
    const xs = cuts.filter((x) => x >= 0 && x <= xmax).sort((a, b) => a - b);
    const roots = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      let lo = xs[i], hi = xs[i + 1];
      let flo = f(lo);
      const fhi = f(hi);
      if (flo === 0) { roots.push(lo); continue; }
      if (flo * fhi > 0) continue;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      roots.push((lo + hi) / 2);
    }
    return roots;
  }

  // その Lightness・色相で sRGB ガマット内に取り得る最大 Chroma。
  // ガマットの断面は青付近で鉤状に張り出しており、中心から外へ向かうと
  // 一度ガマット外に出てから再び入る (例: 純青 #0000FF)。単純な二分探索では
  // 内側の境界で止まってしまうため、各チャンネルが Chroma の 3 次式であることを使い、
  // チャンネルが 0 または 1 になる点を全て求めて、ガマット内にある最も外側の点を採る。
  function maxOkChroma(L, h) {
    if (L <= 0 || L >= 1) return 0;
    const ca = Math.cos(h * DEG), sa = Math.sin(h * DEG);
    // LMS' = L + C * u  →  LMS = (L + C u)^3
    const u = LMS_FROM_AB.map(([ka, kb]) => ka * ca + kb * sa);
    const roots = [];
    for (const row of RGB_FROM_LMS) {
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
      for (let i = 0; i < 3; i++) {
        c0 += row[i] * L * L * L;
        c1 += row[i] * 3 * L * L * u[i];
        c2 += row[i] * 3 * L * u[i] * u[i];
        c3 += row[i] * u[i] * u[i] * u[i];
      }
      roots.push(...cubicRoots(c0, c1, c2, c3, C_SEARCH_MAX));      // チャンネル = 0
      roots.push(...cubicRoots(c0 - 1, c1, c2, c3, C_SEARCH_MAX));  // チャンネル = 1
    }
    roots.sort((a, b) => b - a);
    for (const C of roots) {
      if (inGamut(L, C * ca, C * sa)) return C;
    }
    return 0;
  }

  const toHex = (rgb) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

  function parseHex(str) {
    let s = str.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }

  // ---- 状態更新 ----
  function setHsvRaw(s, v) {
    state.sv = s; state.v = v;
    const r = hsvToHsl(s, v);
    state.l = r.l;
    if (r.s !== null) state.sl = clamp(r.s, 0, 1);
  }

  function setHslRaw(s, l) {
    state.sl = s; state.l = l;
    const r = hslToHsv(s, l);
    state.v = r.v;
    if (r.s !== null) state.sv = clamp(r.s, 0, 1);
  }

  // rgb (0-1) から HSV/HSL を更新
  function applyRgbToHsv(rgb) {
    const n = rgbToHsv(...rgb);
    if (n.s > 1e-6) state.h = n.h;              // 無彩色なら色相を保持
    setHsvRaw(n.v > 1e-6 ? n.s : state.sv, n.v); // 黒なら彩度を保持
  }

  // HSV の現在値から OKLCH を更新
  function syncOklch() {
    const ok = rgbToOklch(hsvToRgbF(state.h, state.sv, state.v));
    state.okL = ok.L;
    if (ok.C > 1e-4) state.okH = ok.h;           // 無彩色なら色相を保持
    const cm = maxOkChroma(ok.L, state.okH);
    if (cm > 1e-5) state.okC = clamp(ok.C / cm, 0, 1); // 白・黒なら相対Chromaを保持
  }

  const setHue = (h) => { state.h = h; syncOklch(); };
  const setHsv = (s, v) => { setHsvRaw(s, v); syncOklch(); };
  const setHsl = (s, l) => { setHslRaw(s, l); syncOklch(); };
  const setRgb = (rgb255) => { applyRgbToHsv(rgb255.map((x) => x / 255)); syncOklch(); };

  function setOklch(L, c, h) {
    state.okL = L; state.okC = c; state.okH = h;
    applyRgbToHsv(oklchToRgbF(L, c * maxOkChroma(L, h), h));
  }

  // HSV/HSL モードでの (彩度, 明度/輝度)
  const getST = () => (state.mode === 'hsv'
    ? { s: state.sv, t: state.v }
    : { s: state.sl, t: state.l });
  const setST = (s, t) => (state.mode === 'hsv' ? setHsv(s, t) : setHsl(s, t));

  // ---- モードごとの数値欄の定義 ----
  const MODES = {
    hsv: {
      legend: 'HSV', labels: ['H', 'S', 'V'], max: [360, 100, 100], hue: 0,
      get: () => [state.h, state.sv * 100, state.v * 100],
      set: (i, n) => {
        if (i === 0) return setHue(n);
        setHsv(i === 1 ? n / 100 : state.sv, i === 2 ? n / 100 : state.v);
      },
    },
    hsl: {
      legend: 'HSL', labels: ['H', 'S', 'L'], max: [360, 100, 100], hue: 0,
      get: () => [state.h, state.sl * 100, state.l * 100],
      set: (i, n) => {
        if (i === 0) return setHue(n);
        setHsl(i === 1 ? n / 100 : state.sl, i === 2 ? n / 100 : state.l);
      },
    },
    oklch: {
      legend: 'OKLCH', labels: ['L', 'C', 'H'], max: [100, 100, 360], hue: 2,
      titles: ['Lightness (%)', '相対 Chroma: 最大 Chroma に対する割合 (%)', 'Hue (°)'],
      get: () => [state.okL * 100, state.okC * 100, state.okH],
      set: (i, n) => {
        const a = [state.okL, state.okC, state.okH];
        a[i] = i === 2 ? n : n / 100;
        setOklch(...a);
      },
    },
  };

  // ---- ジオメトリ ----
  // HSV: 正方形。横 = S, 縦 = V。
  // HSL: 正三角形。頂点 = 純色(右), 白(左上), 黒(左下)。
  //      縦 = L, 横 = 彩度の実量 C = S * (1 - |2L - 1|) で、HSL 双円錐の断面に一致する。
  // OKLCH: 円盤。角度 = 色相, 半径 = 相対 Chroma (中心 0, 円周 = sRGB 内の最大 Chroma)。
  const hslChroma = (l) => 1 - Math.abs(2 * l - 1);

  function stToPoint(s, t, mode) {
    if (mode === 'hsv') {
      return { x: -SQ_HALF + 2 * SQ_HALF * s, y: SQ_HALF - 2 * SQ_HALF * t };
    }
    const r = SHAPE_R;
    return { x: -r / 2 + 1.5 * r * s * hslChroma(t), y: r * SQRT3 / 2 - t * r * SQRT3 };
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
    const mc = hslChroma(t);
    const c = clamp((x + r / 2) / (1.5 * r), 0, mc);
    return { s: mc > 0 ? c / mc : prevS, t };
  }

  // 色相 0 を上にとり時計回り (色相環・OKLCH 円盤で共通)
  const hueToPoint = (h, rad) => ({ x: Math.sin(h * DEG) * rad, y: -Math.cos(h * DEG) * rad });
  const pointToHue = (x, y) => ((Math.atan2(x, -y) / DEG) + 360) % 360;

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const wheel = $('wheel');
  const ringCanvas = $('ring-canvas'), shapeCanvas = $('shape-canvas');
  const ringCtx = ringCanvas.getContext('2d');
  const shapeCtx = shapeCanvas.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');
  const hueThumb = $('hue-thumb'), shapeThumb = $('shape-thumb');
  const okControls = $('ok-controls');
  const lightSlider = $('light-slider'), lightThumb = $('light-thumb');
  const swatch = $('swatch');
  const legend = $('model-legend');
  const compLabels = [$('label-1'), $('label-2'), $('label-3')];
  const cssRow = $('css-row'), outCss = $('out-css');
  const modeButtons = document.querySelectorAll('.mode-toggle button');
  const inputs = {
    c1: $('in-1'), c2: $('in-2'), c3: $('in-3'),
    r: $('in-r'), g: $('in-g'), b: $('in-b'),
    hex: $('in-hex'),
  };
  const compKeys = ['c1', 'c2', 'c3'];
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

  function drawShape() {
    const N = shapeCanvas.width;
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
          const c = clamp((x + r / 2) / (1.5 * r), 0, hslChroma(l));
          const w0 = (l - c / 2) * 255;
          cr = w0 + c * br; cg = w0 + c * bg; cb = w0 + c * bb;
        }
        const o = (j * w + i) * 4;
        d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255;
      }
    }

    shapeCtx.clearRect(0, 0, N, N);
    const path = (c) => {
      if (isHsv) {
        c.rect(R - SQ_HALF * R, R - SQ_HALF * R, 2 * SQ_HALF * R, 2 * SQ_HALF * R);
      } else {
        c.moveTo(R + r * R, R);
        c.lineTo(R - (r / 2) * R, R - (r * SQRT3 / 2) * R);
        c.lineTo(R - (r / 2) * R, R + (r * SQRT3 / 2) * R);
        c.closePath();
      }
    };
    blitClipped(shapeCtx, img, px0, py0, path);
    strokeOutline(shapeCtx, path);
  }

  const dpr = () => window.devicePixelRatio || 1;

  // 図形の内側に沿った境界線 (白に近い部分が背景に溶けないように)。
  // パスでクリップしてから 2 倍幅で描き、内側半分だけを残す。
  // 半透明のグレーなのでライト/ダークどちらの背景でも見える。
  function strokeOutline(ctx, pathFn) {
    const lw = Math.max(1, Math.round(dpr()));
    ctx.save();
    ctx.beginPath();
    pathFn(ctx);
    ctx.clip();
    ctx.beginPath();
    pathFn(ctx);
    ctx.lineWidth = lw * 2;
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.6)';
    ctx.stroke();
    ctx.restore();
  }

  // 線形 sRGB → 8bit sRGB の変換表 (円盤の画素計算を高速化)
  const LUT_N = 8192;
  const gammaLut = new Uint8ClampedArray(LUT_N);
  for (let i = 0; i < LUT_N; i++) gammaLut[i] = Math.round(linearToSrgb(i / (LUT_N - 1)) * 255);
  const encode = (x) => gammaLut[(clamp(x, 0, 1) * (LUT_N - 1) + 0.5) | 0];

  function drawDisk() {
    const N = shapeCanvas.width;
    const R = N / 2;
    const L = state.okL;

    // 現在の Lightness での色相ごとの最大 Chroma
    // (純青付近で最大 Chroma が色相に対して急変するため細かく刻む)
    const K = 2880;
    const table = new Float64Array(K + 1);
    for (let k = 0; k <= K; k++) table[k] = maxOkChroma(L, (k / K) * 360);

    const rad = DISK_R * R;
    const px0 = Math.max(0, Math.floor(R - rad) - 2), px1 = Math.min(N, Math.ceil(R + rad) + 2);
    const w = px1 - px0;
    const img = shapeCtx.createImageData(w, w);
    const d = img.data;
    for (let j = 0; j < w; j++) {
      const y = (px0 + j + 0.5 - R) / rad;
      for (let i = 0; i < w; i++) {
        const x = (px0 + i + 0.5 - R) / rad;
        const dist = Math.hypot(x, y);
        if (dist > 1 + 3 / rad) continue;
        const rel = Math.min(dist, 1);
        let cos = 1, sin = 0, h = 0;
        if (dist > 0) {
          // 角度 h (上=0, 時計回り) を OKLCH の色相として a = C cos h, b = C sin h
          cos = -y / dist; sin = x / dist;
          h = pointToHue(x, y);
        }
        const fk = (h / 360) * K, k0 = fk | 0, f = fk - k0;
        const C = rel * (table[k0] * (1 - f) + table[Math.min(k0 + 1, K)] * f);
        const [lr, lg, lb] = oklabToLinear(L, C * cos, C * sin);
        const o = (j * w + i) * 4;
        d[o] = encode(lr); d[o + 1] = encode(lg); d[o + 2] = encode(lb); d[o + 3] = 255;
      }
    }

    shapeCtx.clearRect(0, 0, N, N);
    const path = (c) => c.arc(R, R, rad, 0, Math.PI * 2);
    blitClipped(shapeCtx, img, px0, px0, path);
    strokeOutline(shapeCtx, path); // L=100% で円盤が白一色になっても輪郭が見える

    // 中心 (Chroma 0 のグレー) を、そのグレーで塗った点として強調する
    const gray = encode(oklabToLinear(L, 0, 0)[1]);
    const k = dpr();
    shapeCtx.save();
    shapeCtx.beginPath();
    shapeCtx.arc(R, R, 5 * k, 0, Math.PI * 2);
    shapeCtx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
    shapeCtx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    shapeCtx.shadowBlur = 4 * k;
    shapeCtx.fill();
    shapeCtx.shadowColor = 'transparent';
    shapeCtx.lineWidth = 1.5 * k;
    shapeCtx.strokeStyle = L > 0.6 ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.7)';
    shapeCtx.stroke();
    shapeCtx.restore();
  }

  let drawnKey = '';
  let rafId = 0;
  function scheduleDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const N = shapeCanvas.width;
      if (!N) return;
      const key = state.mode === 'oklch' ? `ok:${state.okL}:${N}` : `${state.mode}:${state.h}:${N}`;
      if (key === drawnKey) return;
      if (state.mode === 'oklch') drawDisk(); else drawShape();
      drawnKey = key;
    });
  }

  function resizeCanvases() {
    const N = Math.round(wheel.clientWidth * (window.devicePixelRatio || 1));
    if (!N || N === ringCanvas.width) return;
    ringCanvas.width = ringCanvas.height = N;
    shapeCanvas.width = shapeCanvas.height = N;
    drawRing();
    scheduleDraw();
  }

  // ---- UI 更新 ----
  const placeAt = (el, p) => {
    el.style.left = `${50 + p.x * 50}%`;
    el.style.top = `${50 + p.y * 50}%`;
  };

  // Lightness スライダーの背景 (現在の色相・相対 Chroma のまま L を変えた色)
  function lightGradient() {
    const stops = [];
    for (let i = 0; i <= 32; i++) {
      const L = i / 32;
      const rgb = to255(oklchToRgbF(L, state.okC * maxOkChroma(L, state.okH), state.okH));
      stops.push(`${toHex(rgb)} ${(L * 100).toFixed(2)}%`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }

  const fmt = (x, digits) => Number(x.toFixed(digits)).toString();

  // skip: 入力中のフィールドは上書きしない
  function render(skip) {
    const mode = state.mode;
    const def = MODES[mode];
    const isOk = mode === 'oklch';
    const rgb = hsvToRgb(state.h, state.sv, state.v);
    const hex = toHex(rgb);

    // ピッカー
    wheel.classList.toggle('is-disk', isOk);
    okControls.hidden = !isOk;
    cssRow.hidden = !isOk;
    if (isOk) {
      placeAt(shapeThumb, hueToPoint(state.okH, state.okC * DISK_R));
      lightThumb.style.left = `${state.okL * 100}%`;
      lightThumb.style.backgroundColor = hex;
      lightSlider.style.background = lightGradient();
      lightSlider.setAttribute('aria-valuenow', Math.round(state.okL * 100));
      const absC = state.okC * maxOkChroma(state.okL, state.okH);
      outCss.value = `oklch(${fmt(state.okL * 100, 2)}% ${fmt(absC, 4)} ${fmt(state.okH, 2)})`;
    } else {
      const st = getST();
      placeAt(hueThumb, hueToPoint(state.h, RING_MID));
      hueThumb.style.backgroundColor = `hsl(${state.h}, 100%, 50%)`;
      placeAt(shapeThumb, stToPoint(st.s, st.t, mode));
    }
    shapeThumb.style.backgroundColor = hex;
    swatch.style.backgroundColor = hex;

    // モード表示
    legend.textContent = def.legend;
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    compLabels.forEach((el, i) => {
      el.textContent = def.labels[i];
      el.parentElement.title = def.titles ? def.titles[i] : '';
      // 色相欄は -1 と 360 まで許し、入力時に 359 / 0 へ巡回させる
      // (スピナーを押し続けても端で止まらず反対側へ回り込む)
      const isHue = i === def.hue;
      inputs[compKeys[i]].min = isHue ? -1 : 0;
      inputs[compKeys[i]].max = def.max[i];
    });

    // 数値欄
    const comps = def.get().map((x, i) => (i === def.hue ? wrapHue(Math.round(x)) : Math.round(x)));
    const values = { c1: comps[0], c2: comps[1], c3: comps[2], r: rgb[0], g: rgb[1], b: rgb[2], hex };
    for (const key in inputs) {
      if (key === skip) continue;
      inputs[key].value = values[key];
      inputs[key].classList.remove('invalid');
    }

    // アクセシビリティ
    hueThumb.setAttribute('aria-valuenow', Math.round(state.h));
    if (isOk) {
      shapeThumb.setAttribute('aria-label', '色相と相対クロマ');
      shapeThumb.setAttribute('aria-valuetext',
        `色相 ${Math.round(state.okH)}度、相対クロマ ${Math.round(state.okC * 100)}%`);
    } else {
      const isHsv = mode === 'hsv';
      shapeThumb.setAttribute('aria-label', isHsv ? '彩度と明度' : '彩度と輝度');
      shapeThumb.setAttribute('aria-valuetext',
        `彩度 ${comps[1]}%、${isHsv ? '明度' : '輝度'} ${comps[2]}%`);
    }

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

  // ---- ポインタ操作: ホイール ----
  let dragTarget = null;

  function toNormalized(el, e) {
    const rect = el.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
    };
  }

  function applyDrag(p) {
    if (dragTarget === 'disk') {
      const x = p.x / DISK_R, y = p.y / DISK_R;
      const dist = Math.hypot(x, y);
      setOklch(state.okL, clamp(dist, 0, 1), dist > 1e-6 ? pointToHue(x, y) : state.okH);
    } else if (dragTarget === 'hue') {
      setHue(pointToHue(p.x, p.y));
    } else {
      const st = pointToST(p.x, p.y, state.mode, getST().s);
      setST(st.s, st.t);
    }
    render();
  }

  wheel.addEventListener('pointerdown', (e) => {
    const p = toNormalized(wheel, e);
    const dist = Math.hypot(p.x, p.y);
    if (dist > 1.05) return; // 円の外 (四隅) は無視
    if (state.mode === 'oklch') dragTarget = 'disk';
    else dragTarget = dist >= (RING_INNER + SHAPE_R) / 2 ? 'hue' : 'shape';
    wheel.setPointerCapture(e.pointerId);
    (dragTarget === 'hue' ? hueThumb : shapeThumb).focus({ preventScroll: true });
    applyDrag(p);
    e.preventDefault();
  });

  wheel.addEventListener('pointermove', (e) => {
    if (dragTarget && wheel.hasPointerCapture(e.pointerId)) applyDrag(toNormalized(wheel, e));
  });

  const endDrag = () => { dragTarget = null; };
  wheel.addEventListener('pointerup', endDrag);
  wheel.addEventListener('pointercancel', endDrag);

  // ---- ポインタ操作: Lightness スライダー ----
  function applyLight(e) {
    const rect = lightSlider.getBoundingClientRect();
    setOklch(clamp((e.clientX - rect.left) / rect.width, 0, 1), state.okC, state.okH);
    render();
  }
  lightSlider.addEventListener('pointerdown', (e) => {
    lightSlider.setPointerCapture(e.pointerId);
    lightSlider.focus({ preventScroll: true });
    applyLight(e);
    e.preventDefault();
  });
  lightSlider.addEventListener('pointermove', (e) => {
    if (lightSlider.hasPointerCapture(e.pointerId)) applyLight(e);
  });

  $('reset-chroma').addEventListener('click', () => {
    setOklch(state.okL, 0, state.okH);
    render();
  });

  // ---- キーボード操作 (Shiftで10倍) ----

  hueThumb.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
    else return;
    setHue(wrapHue(Math.round(state.h) + d));
    render();
    e.preventDefault();
  });

  shapeThumb.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 10 : 1;
    const keys = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const k = keys[e.key];
    if (!k) return;
    if (state.mode === 'oklch') {
      // 左右 = 色相, 上下 = 相対 Chroma
      setOklch(state.okL,
        clamp(state.okC + (k[1] * big) / 100, 0, 1),
        wrapHue(Math.round(state.okH) + k[0] * big));
    } else {
      const { s, t } = getST();
      setST(clamp(s + (k[0] * big) / 100, 0, 1), clamp(t + (k[1] * big) / 100, 0, 1));
    }
    render();
    e.preventDefault();
  });

  lightSlider.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 10 : 1) / 100;
    let L = state.okL;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') L += step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') L -= step;
    else if (e.key === 'Home') L = 0;
    else if (e.key === 'End') L = 1;
    else return;
    setOklch(clamp(L, 0, 1), state.okC, state.okH);
    render();
    e.preventDefault();
  });

  // ---- 数値入力 ----
  function readNum(key, max, min = 0) {
    const el = inputs[key];
    const n = Number(el.value);
    const ok = el.value !== '' && Number.isFinite(n) && n >= min && n <= max;
    el.classList.toggle('invalid', !ok);
    return ok ? n : null;
  }

  compKeys.forEach((key, i) => {
    inputs[key].addEventListener('input', () => {
      const def = MODES[state.mode];
      const isHue = i === def.hue;
      let n = readNum(key, def.max[i], isHue ? -1 : 0);
      if (n === null) return;
      if (isHue) {
        const w = wrapHue(n);
        if (w !== n) { n = w; inputs[key].value = w; } // 360 → 0, -1 → 359
      }
      def.set(i, n);
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
    if (Object.hasOwn(MODES, saved)) state.mode = saved;
  } catch { /* 読めなければ既定の HSV */ }

  state.h = 210;
  if (!loadFromHash()) setHsv(0.8, 0.9);

  new ResizeObserver(resizeCanvases).observe(wheel);
  window.addEventListener('resize', resizeCanvases); // ズーム等による devicePixelRatio 変化
  render();
})();
