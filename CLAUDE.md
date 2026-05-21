# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業するときに参照するガイドです。
詳細な設計ドキュメントは `docs/dev/` 配下の .qmd ファイルに分割されています（gitignore 対象・開発用）。

---

## ドキュメント構成

- [docs/dev/00-overview.qmd](docs/dev/00-overview.qmd) — プロジェクト概要
- [docs/dev/01-requirements.qmd](docs/dev/01-requirements.qmd) — 機能要件
- [docs/dev/02-tech-stack.qmd](docs/dev/02-tech-stack.qmd) — 技術スタック
- [docs/dev/03-oss-strategy.qmd](docs/dev/03-oss-strategy.qmd) — 既存 OSS の活用方針
- [docs/dev/04-repo-structure.qmd](docs/dev/04-repo-structure.qmd) — リポジトリ構成
- [docs/dev/05-implementation-guide.qmd](docs/dev/05-implementation-guide.qmd) — 実装ガイドライン
- [docs/dev/06-license.qmd](docs/dev/06-license.qmd) — ライセンス
- [docs/dev/07-readme-policy.qmd](docs/dev/07-readme-policy.qmd) — README の方針
- [docs/dev/08-development-phases.qmd](docs/dev/08-development-phases.qmd) — 開発フェーズ
- [docs/dev/09-claude-code-tasks.qmd](docs/dev/09-claude-code-tasks.qmd) — Claude Code への依頼事項
- [docs/dev/10-references.qmd](docs/dev/10-references.qmd) — 参考資料
- [docs/dev/11-ridership-data.qmd](docs/dev/11-ridership-data.qmd) — 乗降実績データ対応

---

## クイックリファレンス

### プロジェクト名
`gtfs-cooker` — GTFS ZIP → GeoJSON 変換のブラウザ完結型 Web アプリ

### 技術スタック
- Vite + TypeScript + React
- DuckDB-WASM（データ格納・リレーショナルクエリ）
- Turf.js（空間処理: buffer / union / convex 等）
- JSZip（ZIP 展開）
- deck.gl（データレイヤー描画）+ MapLibre GL JS（ベースマップ）
- Zustand（状態管理）

### 絶対に守るルール
- **GTFS データは外部送信しない**（完全クライアントサイド処理）
- **Google Analytics は使わない**
- **Mapbox GL JS v3+ は採用しない**（MapLibre を使う）
- **min ファイルをリポジトリに同梱しない**
- **大きなアーキテクチャ変更はユーザーに確認してから**

### 命名規則
- ファイル名: `kebab-case.ts`
- 型・クラス: `PascalCase`
- 関数・変数: `camelCase`
- 定数: `UPPER_SNAKE_CASE`
