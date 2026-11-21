# Color Picker

GitHub Pages で動作する、ビルド不要の静的 Web アプリです。

## 機能

- 色相環と、その内側のピッカーによる色選択（マウス・タッチ対応）
  - HSV モード: 正方形（横 = S、縦 = V）
  - HSL モード: 正三角形（頂点 = 純色・白・黒、縦 = L）
- 右上のトグルで HSV / HSL を切り替え（選択はブラウザに記憶）
- HSV または HSL / RGB / HEX の相互入力
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
