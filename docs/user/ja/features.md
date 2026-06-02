---
title: 機能一覧
---

# 機能一覧

GTFS-cooker で生成できるレイヤーの一覧です。

## 基本レイヤー

### Stops（停留所）

<p align="center"><img src="../images/stops.png" width="50%"></p>

- **形状**: Point
- **説明**: GTFS の全停留所をポイントとして出力します。
- **主なプロパティ**: stop_id, stop_name, stop_lat, stop_lon, routes（経由路線一覧）, route_count, trip_weekday（平日便数）, trip_holiday（休日便数）, trip_morning / trip_daytime / trip_evening / trip_latenight（時間帯別便数）, trip_04〜trip_27（時間別便数）

### Lines（路線）

<p align="center"><img src="../images/lines.png" width="50%"></p>

- **形状**: LineString / MultiLineString
- **説明**: 路線ごとの形状を shapes.txt から生成します。shapes.txt がない場合は停留所の並びから推定します。
- **主なプロパティ**: route_id, route_short_name, route_long_name, route_type, route_color, agency_name, trip_weekday, trip_holiday, 時間帯別便数, 時間別便数

### Trips（便）

<p align="center"><img src="../images/trips.gif" width="50%"></p>

- **形状**: LineString（Kepler.gl Trip 形式）
- **説明**: 指定した基準日の便を時刻情報付きで出力します。Kepler.gl にインポートしてアニメーション表示できます。
- **必須パラメータ**: 基準日
- **主なプロパティ**: trip_id, route_id, service_id, direction_id, trip_headsign

### Segments（区間）

<p align="center"><img src="../images/segments.png" width="50%"></p>

- **形状**: LineString
- **説明**: 隣接する停留所間のセグメント（区間）を路線別に生成します。
- **主なプロパティ**: from_stop_id, from_stop_name, to_stop_id, to_stop_name, route_id, trip_weekday, trip_holiday, 時間帯別便数, distance_m

## バッファ・ディゾルブレイヤー

### Stops Buffer / Lines Buffer

<div style="display:flex;gap:8px"><img src="../images/stops-buffer.png" style="width:50%"><img src="../images/lines-buffer.png" style="width:50%"></div>

- **形状**: Polygon
- **説明**: 停留所または路線から指定した半径のバッファ（緩衝帯）を生成します。
- **パラメータ**: バッファ半径（メートル、デフォルト 300m）

### Stops Dissolved / Lines Dissolved

<div style="display:flex;gap:8px"><img src="../images/stops-dissolved.png" style="width:50%"><img src="../images/lines-dissolved.png" style="width:50%"></div>

- **形状**: Polygon
- **説明**: バッファを結合（ディゾルブ）して、路線網のサービスエリアを表現します。
- **グループ化**: なし（全体結合）/ 事業者別 / 路線別 / shape 別

## エリアレイヤー

### Envelope（バウンディングボックス）

<p align="center"><img src="../images/envelope.png" width="50%"></p>

- **形状**: Polygon
- **説明**: 全停留所を囲む最小の矩形（バウンディングボックス）を生成します。

### Convex Hull（凸包）

<p align="center"><img src="../images/convex.png" width="50%"></p>

- **形状**: Polygon
- **説明**: 全停留所を囲む最小の凸多角形を生成します。

### Concave Hull（凹包）

<p align="center"><img src="../images/concave.png" width="50%"></p>

- **形状**: Polygon
- **説明**: 停留所の分布に沿った凹多角形を生成します。最大エッジ長パラメータで精度を調整できます。
- **パラメータ**: 最大エッジ長（km、デフォルト 2km）

## Matching レイヤー

乗降実績データを GTFS と結合して生成するレイヤーです。詳細は [Matching（乗降実績の結合）](./matching) を参照してください。

| レイヤー | 形状 | 説明 |
|---------|------|------|
| Matching Stops | Point | 停留所別の乗降数（乗車数 + 降車数でサイズが変化） |
| Matching Lines | LineString | 路線別の乗降数（乗降数で線の太さが変化） |
| Matching Segments | LineString | 区間別の乗降数 |
| Matching Flow | Arc | OD 流動（乗車停留所→降車停留所を集約） |
| Matching OD | Arc | OD 個票（レコードごとに 1 本のアーク） |

## 便数の集計定義

### 平日・休日

便数の集計で使用する曜日は以下のとおりです。

| プロパティ | 集計対象 | calendar.txt の条件 |
|-----------|---------|-------------------|
| trip_weekday | 平日の便数 | monday = 1 |
| trip_holiday | 休日の便数 | sunday = 1 |

### 時間帯

便数の時間帯区分は以下のとおりです。

| 時間帯 | プロパティ名 | 時間範囲 |
|--------|-------------|---------|
| 朝 | trip_morning | 4:00 — 8:59 |
| 昼 | trip_daytime | 9:00 — 16:59 |
| 夕 | trip_evening | 17:00 — 20:59 |
| 深夜 | trip_latenight | 21:00 — 27:59 |

::: info
時間別便数（trip_04〜trip_27）と時間帯別便数はいずれも平日の便数です。時間帯別便数の合計は trip_weekday と一致します。
:::
