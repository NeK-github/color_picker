# Color Picker

GitHub Pages で動作する、ビルド不要の静的 Web アプリです。

## 機能

- 色相環と、その内側のピッカーによる色選択（マウス・タッチ対応）
  - HSV モード: 正方形（横 = S、縦 = V）
  - HSL モード: 正三角形（頂点 = 純色・白・黒、縦 = L）
- 相対 OKLCH モード: 円盤と Lightness スライダー
  - 円盤の角度 = 色相、中心 = Chroma 0、円周 = その色相・Lightness で sRGB 内に取り得る最大 Chroma
  - 数値欄の C は最大 Chroma に対する割合（%）。実際の値は CSS の `oklch()` 表記で表示
- 絶対 OKLCH モード: 円盤と Lightness スライダー
  - 円盤の角度 = 色相、中心 = Chroma 0、半径 = Chroma の絶対値（外周 = 0.33）で、同心円上は同じ Chroma
  - 塗られた領域の輪郭は、その Lightness で sRGB 内に取り得る最大 Chroma に沿った不定形
  - C = 0.1 / 0.2 / 0.3 の目盛り円を表示。数値欄の C は絶対値（sRGB 外の値は上限で切られる）
  - Lightness を動かしても指定した Chroma を保持（ガマット外になる間だけ上限で切られる）
- 右上のトグルで HSV / HSL / 相対OKLCH / 絶対OKLCH を切り替え（選択はブラウザに記憶）
- 各モードの値 / RGB / HEX の相互入力
- HEX 値のクリップボードコピー
- URL ハッシュ（例: `index.html#3399FF`）で色を共有・復元
- キーボード操作（矢印キー、Shift で 10 倍ステップ）
- ダークモード対応

## ローカルで確認

```sh
python3 -m http.server 8000
# http://localhost:8000/ を開く
```

## GitHub Pages で公開

1. このディレクトリを GitHub リポジトリに push する
2. リポジトリの Settings → Pages → Build and deployment で
   Source を「Deploy from a branch」、Branch を `main` / `/ (root)` に設定する

## 構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | ページ本体 |
| `style.css` | スタイル |
| `app.js` | カラーピッカーのロジック |
| `favicon.svg` | タブのアイコン |
| `.nojekyll` | GitHub Pages の Jekyll 処理を無効化 |
