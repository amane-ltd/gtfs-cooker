---
title: 概要
---

::: tip 言語 / Language
[English version is available here.](/en/)
:::

# GTFS-cooker

![GTFS-cooker](../images/favicon.svg)

GTFS-cooker は、GTFS（標準的なバス情報フォーマット）の ZIP ファイルを GeoJSON に変換するブラウザ完結型の Web アプリです。

## 特徴

- **完全クライアントサイド処理** — アップロードしたデータはサーバーに送信されません。すべてブラウザ内で処理されます。
- **多彩な出力レイヤー** — 停留所・路線・便・バッファ・ディゾルブ・凸包/凹包・セグメントなど、12 種類以上のレイヤーを生成できます。
- **乗降実績データとの結合（Matching）** — CSV / Excel 形式の乗降実績データを GTFS と結合し、停留所別・路線別・区間別・OD 流動の可視化レイヤーを作成できます。
- **複数の出力形式** — GeoJSON・CSV・XLSX でダウンロード可能です。
- **地図プレビュー** — 生成結果を deck.gl + MapLibre GL JS でその場でプレビューできます。
- **日英対応** — UI は日本語・英語を切り替え可能です。

## 技術スタック

| 領域 | 技術 |
|------|------|
| フレームワーク | Vite + React + TypeScript |
| データ処理 | DuckDB-WASM |
| 空間処理 | Turf.js |
| ZIP 展開 | JSZip |
| 地図描画 | deck.gl + MapLibre GL JS |
| 状態管理 | Zustand |

## リンク

- [アプリを開く](https://amane-ltd.github.io/gtfs-cooker/)
- [GitHub リポジトリ](https://github.com/amane-ltd/gtfs-cooker)
