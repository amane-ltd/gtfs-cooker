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

COMmmmONS プラットフォームから出力される IC カードデータ形式です。仕様の詳細は [国土交通省 公共交通データ標準仕様（COMmmmONS）](https://www.mlit.go.jp/commmmons/document/005/) を参照してください。

| 列名 | 説明 |
|------|------|
| ridership_record_id | レコード ID |
| payment_at | 決済日時（時間帯別集計の `時刻列` として自動使用） |
| boarding_station_name / _code | 乗車停留所名 / コード |
| alighting_station_name / _code | 降車停留所名 / コード |
| boarding_route_name / boarding_route_id | 路線名 / ID |
| operating_agency_name / _code | 事業者名 / コード |
| adult_passenger_count（等） | 乗客数（年齢区分別カラムを合算） |

### 乗降実績（一件明細）

汎用的な OD 個票形式です。列の対応関係は「列設定」で手動で指定します。

| 必要な列 | 説明 |
|---------|------|
| 乗車停留所列 | 乗車地の停留所名 or ID |
| 降車停留所列 | 降車地の停留所名 or ID |
| 乗降数列（複数可） | 1 行あたりの乗客数（複数列を加算） |
| 路線列（任意） | 路線名 or ID |
| 事業者列（任意） | 事業者名 or ID |
| 時刻列（任意） | 時間帯別集計用 |

### OD 集計

OD ペアごとに集約されたデータ形式です。

| 必要な列 | 説明 |
|---------|------|
| 乗車停留所コード/名 | 乗車地 |
| 降車停留所コード/名 | 降車地 |
| 乗客数 | OD ペアごとの合計人数 |
| 時刻列（任意） | 時間帯別集計用 |

### 停留所集計

停留所ごとの乗降数が集約されたデータ形式です。

| 必要な列 | 説明 |
|---------|------|
| 停留所コード/名 | 停留所の識別子 |
| 乗車数 | 乗車人数 |
| 降車数 | 降車人数 |
| 時刻列（任意） | 時間帯別集計用 |

### 系統集計

路線（系統）ごとに集約されたデータ形式です。

| 必要な列 | 説明 |
|---------|------|
| 路線 ID/名 | 路線の識別子 |
| 乗客数 | 路線の合計乗客数 |
| 時刻列（任意） | 時間帯別集計用 |

### 停留所×便別実績

停留所と便の組み合わせ別の詳細データ形式です。便内の停留所順序は **時刻列** で並べ替えて自動算出します。

| 必要な列 | 説明 |
|---------|------|
| 停留所 ID/名 | 停留所の識別子 |
| 便 ID | 便の識別子 |
| 時刻列 | 便内順序キー兼時間帯別集計用（必須） |
| 通過人数 | 当該停留所での通過乗客数 |
| 乗車人数 | 乗車人数 |
| 降車人数 | 降車人数 |
| 路線列（任意） | 路線名 or ID |

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

各レイヤーで出力可能なプロパティ一覧です。実際に出力するプロパティは「4. 出力プロパティ」で選択できます。

### Stops レイヤー（Point）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| stop_id | string | 停留所 ID |
| stop_code | string | 停留所コード |
| stop_name | string | 停留所名 |
| stop_lat | number | 緯度 |
| stop_lon | number | 経度 |
| location_type | number | ロケーションタイプ |
| parent_station | string | 親駅 ID |
| platform_code | string | プラットフォームコード |
| zone_id | string | 運賃ゾーン ID |
| wheelchair_boarding | number | 車椅子対応 |
| stop_url | string | 停留所 URL |
| stop_desc | string | 停留所説明 |
| routes | string[] | 経由路線 ID 一覧 |
| agency_name | string | 事業者名 |
| route_count | number | 経由路線数 |
| trip_weekday | number | 平日便数 |
| trip_holiday | number | 休日便数 |
| trip_morning | number | 朝（4〜8 時）の便数 |
| trip_daytime | number | 昼（9〜16 時）の便数 |
| trip_evening | number | 夕（17〜20 時）の便数 |
| trip_latenight | number | 深夜（21〜27 時）の便数 |
| trip_04 〜 trip_27 | number | 時間別便数（平日） |
| travel_time_min | number | ターゲット停留所までの所要時間（分） |
| travel_time_route_name | string | 所要時間を算出した路線名 |
| travel_time_target_stop | string | ターゲット停留所名 |

### Lines レイヤー（MultiLineString）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| route_id | string | 路線 ID |
| route_short_name | string | 路線略称 |
| route_long_name | string | 路線名 |
| route_type | number | 路線種別 |
| route_color | string | 路線カラー（#RRGGBB） |
| route_text_color | string | テキストカラー |
| route_url | string | 路線 URL |
| route_desc | string | 路線説明 |
| agency_id | string | 事業者 ID |
| agency_name | string | 事業者名 |
| trip_weekday | number | 平日便数 |
| trip_holiday | number | 休日便数 |
| trip_morning 〜 trip_latenight | number | 時間帯別便数 |
| trip_04 〜 trip_27 | number | 時間別便数 |

### Trips レイヤー（LineString, Kepler.gl Trip 形式）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| trip_id | string | 便 ID |
| route_id | string | 路線 ID |
| service_id | string | サービス ID |
| route_short_name | string | 路線略称 |
| route_long_name | string | 路線名 |
| route_type | number | 路線種別 |
| route_color | string | 路線カラー |
| direction_id | number | 方向 ID |
| trip_headsign | string | 行先表示 |
| shape_id | string | 形状 ID |

### Segments レイヤー（LineString）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| from_stop_id | string | 出発停留所 ID |
| from_stop_name | string | 出発停留所名 |
| from_stop_lat | number | 出発停留所の緯度 |
| from_stop_lon | number | 出発停留所の経度 |
| to_stop_id | string | 到着停留所 ID |
| to_stop_name | string | 到着停留所名 |
| to_stop_lat | number | 到着停留所の緯度 |
| to_stop_lon | number | 到着停留所の経度 |
| route_id | string | 路線 ID |
| route_short_name | string | 路線略称 |
| trip_weekday | number | 平日便数 |
| trip_holiday | number | 休日便数 |
| trip_morning 〜 trip_latenight | number | 時間帯別便数 |
| trip_04 〜 trip_27 | number | 時間別便数 |
| distance_m | number | 区間距離（メートル） |

### Stops Dissolved / Lines Dissolved（Polygon）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| agency_name | string | 事業者名（グループ化に使用） |
| route_id | string | 路線 ID（グループ化に使用） |
| route_short_name | string | 路線略称（Lines Dissolved 限定） |
| agency_id | string | 事業者 ID（Lines Dissolved 限定） |
| shape_id | string | 形状 ID（Lines Dissolved 限定） |

### Envelope / Convex / Concave（Polygon）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| agency_name | string | 事業者名 |
| bbox | number[] | バウンディングボックス座標（Envelope 限定） |

### Matching Stops レイヤー（Point）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| stop_id | string | 停留所 ID |
| stop_name | string | 停留所名 |
| ridership_on | number | 総乗車数 |
| ridership_off | number | 総降車数 |
| ridership_morning 〜 ridership_latenight | number | 時間帯別乗降合計（時刻列設定時） |
| ridership_04 〜 ridership_27 | number | 時間別乗降合計（時刻列設定時） |
| ridership_per_trip | number | 便あたり乗降数（チェックボックスON時） |
| ridership_per_trip_morning 〜 ridership_per_trip_latenight | number | 時間帯別の便あたり乗降数 |
| ridership_per_trip_04 〜 ridership_per_trip_27 | number | 時間別の便あたり乗降数 |

::: info
`ridership_*` は GeoJSON 出力時、対応する `trip_*` プロパティと同じ feature 上に並びます。matching-stops では GTFS の Stops レイヤー全プロパティ（trip_weekday 等）も合わせて出力されます。
:::

### Matching Lines レイヤー（MultiLineString）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| route_id | string | 路線 ID |
| route_short_name | string | 路線略称 |
| route_long_name | string | 路線名 |
| ridership_count | number | 路線の総乗客数 |
| ridership_morning 〜 ridership_latenight | number | 時間帯別乗客数（時刻列設定時） |
| ridership_04 〜 ridership_27 | number | 時間別乗客数（時刻列設定時） |
| ridership_per_trip | number | 便あたり乗客数（チェックボックスON時） |
| ridership_per_trip_morning 〜 ridership_per_trip_latenight | number | 時間帯別の便あたり乗客数 |
| ridership_per_trip_04 〜 ridership_per_trip_27 | number | 時間別の便あたり乗客数 |

### Matching Segments レイヤー（LineString）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| from_stop_id | string | 出発停留所 ID |
| from_stop_name | string | 出発停留所名 |
| from_stop_lat | number | 出発停留所の緯度 |
| from_stop_lon | number | 出発停留所の経度 |
| to_stop_id | string | 到着停留所 ID |
| to_stop_name | string | 到着停留所名 |
| to_stop_lat | number | 到着停留所の緯度 |
| to_stop_lon | number | 到着停留所の経度 |
| ridership | number | 区間通過乗客数 |
| ridership_morning 〜 ridership_latenight | number | 時間帯別の通過乗客数 |
| ridership_04 〜 ridership_27 | number | 時間別の通過乗客数 |
| ridership_per_trip | number | 便あたり通過乗客数（チェックボックスON時） |
| ridership_per_trip_morning 〜 ridership_per_trip_latenight | number | 時間帯別の便あたり通過乗客数 |
| ridership_per_trip_04 〜 ridership_per_trip_27 | number | 時間別の便あたり通過乗客数 |

### Matching Flow レイヤー（Arc, OD 集約）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| boarding_stop_id | string | 乗車停留所 ID |
| boarding_stop_name | string | 乗車停留所名 |
| boarding_lat | number | 乗車停留所の緯度 |
| boarding_lon | number | 乗車停留所の経度 |
| alighting_stop_id | string | 降車停留所 ID |
| alighting_stop_name | string | 降車停留所名 |
| alighting_lat | number | 降車停留所の緯度 |
| alighting_lon | number | 降車停留所の経度 |
| ridership | number | 乗客数（OD ペアごとの集約値） |
| ridership_morning 〜 ridership_latenight | number | 時間帯別の OD ペア乗客数 |
| ridership_04 〜 ridership_27 | number | 時間別の OD ペア乗客数 |

### Matching OD レイヤー（Arc, 個票）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| boarding_stop_id | string | 乗車停留所 ID |
| boarding_stop_name | string | 乗車停留所名 |
| boarding_lat | number | 乗車停留所の緯度 |
| boarding_lon | number | 乗車停留所の経度 |
| alighting_stop_id | string | 降車停留所 ID |
| alighting_stop_name | string | 降車停留所名 |
| alighting_lat | number | 降車停留所の緯度 |
| alighting_lon | number | 降車停留所の経度 |
| passenger_count | number | 1 個票あたりの乗客数 |

### Matching Trips レイヤー（LineString, 便×区間, 時刻アニメ対応）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| trip_id | string | データ側の便ID（停留所×便別実績では生の便ID。OD 形式では割り当てられた GTFS trip_id） |
| date | string | 乗降日（YYYY-MM-DD） |
| route_id | string | データ側の路線/経路ID または GTFS route_id |
| route_short_name | string \| null | GTFS routes.txt の短縮名（JOIN できれば） |
| route_long_name | string \| null | GTFS routes.txt の長名（JOIN できれば） |
| direction_id | number \| null | GTFS の方向 ID（OD 形式のみ） |
| service_id | string \| null | GTFS の service_id（OD 形式のみ） |
| from_stop_id | string | 出発停留所 ID |
| from_stop_name | string | 出発停留所名 |
| to_stop_id | string | 到着停留所 ID |
| to_stop_name | string | 到着停留所名 |
| departure_time | string | 出発時刻（GTFS HH:MM:SS、または停留所×便別実績の元時刻） |
| arrival_time | string | 到着時刻 |
| onboard | number | 区間通過時の乗車中人数 |
| boardings_at_from | number | from_stop での乗車人数 |
| alightings_at_to | number | to_stop での降車人数 |

ジオメトリ座標は `[lon, lat, 0, unix_seconds]` の 4 要素（Kepler.gl Trip 形式）。タイムバーで時刻ベースのアニメーション再生に対応。

### Matching Ridership レイヤー（LineString, 個票単位の軌跡）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| ridership_record_id | number | データ内の通し ID |
| trip_id | string | 割り当てられた GTFS trip_id |
| date | string | 乗降日（YYYY-MM-DD） |
| route_id | string | GTFS route_id |
| route_short_name | string \| null | GTFS routes.txt の短縮名 |
| boarding_stop_id | string | 乗車停留所 ID |
| boarding_stop_name | string | 乗車停留所名 |
| boarding_time | string | 乗車時刻（HH:MM） |
| alighting_stop_id | string | 降車停留所 ID |
| alighting_stop_name | string | 降車停留所名 |
| alighting_time | string | 降車時刻（HH:MM） |
| passenger_count | number | 乗客数（個票単位） |
| duration_min | number | 乗車時間（分） |

ジオメトリ座標は `[lon, lat, 0, unix_seconds]` の 4 要素（Kepler.gl Trip 形式）。各座標は trip 内の停留所を順に並べたもので、4 要素目は GTFS の departure_time から算出した日付込み unix 秒。
