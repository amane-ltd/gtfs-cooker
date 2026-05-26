---
title: ファイル定義
---

# ファイル定義

## 入力: GTFS ファイル

GTFS-cooker は [GTFS Schedule](https://gtfs.org/schedule/) 仕様に準拠した ZIP ファイルを入力として受け付けます。GTFS-JP（日本独自拡張）にも対応しています。

### 必須ファイル

| ファイル | 説明 |
|---------|------|
| agency.txt | 事業者情報 |
| routes.txt | 路線情報 |
| trips.txt | 便情報 |
| stop_times.txt | 停車時刻情報 |

### 条件付き必須ファイル

| ファイル | 説明 |
|---------|------|
| stops.txt | 停留所情報 |
| calendar.txt | 運行日パターン（平日/休日判定に使用） |
| calendar_dates.txt | 運行日の例外（追加/除外） |
| feed_info.txt | フィード情報 |

### 任意ファイル

| ファイル | 説明 | 利用するレイヤー |
|---------|------|----------------|
| shapes.txt | 路線の形状座標 | Lines, Lines Buffer, Lines Dissolved |
| frequencies.txt | 運行頻度 | — |
| transfers.txt | 乗り換え情報 | — |

::: info
shapes.txt がない場合、Lines レイヤーは停留所の並び順から路線形状を推定します。
:::

### GTFS-JP 拡張ファイル

| ファイル | 説明 |
|---------|------|
| agency_jp.txt | 事業者情報（日本語拡張） |
| routes_jp.txt | 路線情報（日本語拡張） |
| office_jp.txt | 営業所情報 |

---

## 入力: 乗降実績データ

Matching 機能で使用する乗降実績データの形式です。CSV / TSV / Excel（.xlsx, .xls）に対応しています。

### OD 実績（COMmmmONS）

COMmmmONS プラットフォームから出力される IC カードデータ形式です。

| 列名 | 説明 |
|------|------|
| ridership_record_id | レコード ID |
| payment_at | 決済日時 |
| boarding_station_name | 乗車停留所名 |
| alighting_station_name | 降車停留所名 |
| route_name | 路線名 |
| agency_name | 事業者名 |
| passenger_count（等） | 乗客数 |

### 乗降実績（一件明細）

汎用的な OD 個票形式です。列の対応関係は「列設定」で手動で指定します。

| 必要な列 | 説明 |
|---------|------|
| 乗車停留所列 | 乗車地の停留所名 or ID |
| 降車停留所列 | 降車地の停留所名 or ID |
| 路線列（任意） | 路線名 or ID |
| 事業者列（任意） | 事業者名 or ID |

### OD 集計

OD ペアごとに集約されたデータ形式です。

| 必要な列 | 説明 |
|---------|------|
| 乗車停留所コード/名 | 乗車地 |
| 降車停留所コード/名 | 降車地 |
| 乗客数 | OD ペアごとの合計人数 |

### 停留所集計

停留所ごとの乗降数が集約されたデータ形式です。

| 必要な列 | 説明 |
|---------|------|
| 停留所コード/名 | 停留所の識別子 |
| 乗車数 | 乗車人数 |
| 降車数 | 降車人数 |

### 系統集計

路線（系統）ごとに集約されたデータ形式です。

| 必要な列 | 説明 |
|---------|------|
| 路線 ID/名 | 路線の識別子 |
| 乗客数 | 路線の合計乗客数 |

### 停留所×便別実績

停留所と便の組み合わせ別の詳細データ形式です。

| 必要な列 | 説明 |
|---------|------|
| 停留所 ID/名 | 停留所の識別子 |
| 便 ID | 便の識別子 |
| 停留所順 | 便における停車順序 |
| 乗車人数 | 乗車人数 |
| 降車人数 | 降車人数 |
| 通過人数（任意） | 通過乗客数 |

### マッピング CSV

名寄せで使用するマッピング CSV の形式です。

| 列 | 説明 |
|----|------|
| 1 列目 | 乗降実績データ側の値（停留所名/ID） |
| 2 列目 | GTFS 側の値（stop_id, route_id 等） |

- ヘッダー行は不要です。
- 同じ乗降実績値に複数の GTFS 値をマッピングする場合は、複数行に記述します。

---

## 出力: GeoJSON プロパティ

### Stops レイヤー

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| stop_id | string | 停留所 ID |
| stop_code | string | 停留所コード |
| stop_name | string | 停留所名 |
| stop_lat | number | 緯度 |
| stop_lon | number | 経度 |
| location_type | number | ロケーションタイプ |
| parent_station | string | 親駅 ID |
| routes | string[] | 経由路線 ID 一覧 |
| agency_name | string | 事業者名 |
| route_count | number | 経由路線数 |
| trip_weekday | number | 平日便数 |
| trip_holiday | number | 休日便数 |
| trips_morning | number | 朝（4〜8 時）の便数 |
| trips_daytime | number | 昼（9〜16 時）の便数 |
| trips_evening | number | 夕（17〜20 時）の便数 |
| trips_latenight | number | 深夜（21〜27 時）の便数 |
| trips_04 〜 trips_27 | number | 時間別便数（平日） |

### Lines レイヤー

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| route_id | string | 路線 ID |
| route_short_name | string | 路線略称 |
| route_long_name | string | 路線名 |
| route_type | number | 路線種別 |
| route_color | string | 路線カラー（#RRGGBB） |
| route_text_color | string | テキストカラー |
| agency_id | string | 事業者 ID |
| agency_name | string | 事業者名 |
| trip_weekday | number | 平日便数 |
| trip_holiday | number | 休日便数 |
| trips_morning 〜 trips_latenight | number | 時間帯別便数 |
| trips_04 〜 trips_27 | number | 時間別便数 |

### Segments レイヤー

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| from_stop_id | string | 出発停留所 ID |
| from_stop_name | string | 出発停留所名 |
| to_stop_id | string | 到着停留所 ID |
| to_stop_name | string | 到着停留所名 |
| route_id | string | 路線 ID |
| route_short_name | string | 路線略称 |
| trip_weekday | number | 平日便数 |
| trip_holiday | number | 休日便数 |
| trips_morning 〜 trips_latenight | number | 時間帯別便数 |
| trips_04 〜 trips_27 | number | 時間別便数 |
| distance_m | number | 区間距離（メートル） |

### Matching Stops レイヤー

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| stop_id | string | 停留所 ID |
| stop_name | string | 停留所名 |
| ridership_on | number | 乗車数 |
| ridership_off | number | 降車数 |

### Matching Lines レイヤー

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| route_id | string | 路線 ID |
| route_short_name | string | 路線略称 |
| route_long_name | string | 路線名 |
| ridership_count | number | 乗降数 |

### Matching Flow レイヤー

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| boarding_stop_id | string | 乗車停留所 ID |
| boarding_stop_name | string | 乗車停留所名 |
| alighting_stop_id | string | 降車停留所 ID |
| alighting_stop_name | string | 降車停留所名 |
| ridership | number | 乗客数（集約値） |
