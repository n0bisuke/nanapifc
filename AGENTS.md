# AGENTS.md — nanapiフットサル支援ツール

## プロジェクトの目的

nanapiフットサルチームの活動を支援する小さなツール群のリポジトリ。
第一弾として「銀座deフットサル 蒲田スタジアム」の個人参加イベント(LaBOLA予約サイト)を
Googleカレンダーに同期し、1時間おきに募集状況(残数・満席・受付終了)を更新する。

- 対象サイト: https://yoyaku.labola.jp/r/shop/1047/event/individual/
- 日付指定URL: `?hold_on_at=YYYY-MM-DD&kind=individual` (1日分のみ返る)
- キーワード絞り込み: `keyword=チーム` で「チーム参加OK」のイベントのみ(デフォルト)

- 対応済みの外部データ源:
  - LaBOLA予約サイト(上記)
  - 調整さん(chouseisan.com): 出欠表ページのHTMLに `window.Chouseisan = {...}` JSONが埋め込まれる。
    `event.choices`(日程候補)と `event.members[].kouho`(1=○ 2=△ 3=×)を集計する。
    日程ラベルには年がなく(例: 「9/26(土) 19:00〜」「昼~夕方頃」)、年は現在に最も近い年で推定する。

## コマンド

```bash
npm install              # 依存のインストール
npm run typecheck        # tsc --noEmit
npm test                 # vitest run
npm run sync             # 本同期(GOOGLE_CALENDAR_ID / GCP_SA_KEY が必要)
npm run sync -- --dry-run # 取得結果の表示のみ(認証不要・カレンダー操作なし)
```

ローカルでは環境変数を `.dev.env` に書く(gitignore済み、絶対にコミットしない)。

## 構成

```
src/
  index.ts     エントリポイント(sync CLI、2カレンダーへの書き分け)
  config.ts    環境変数の集約(SHOP_ID / SYNC_DAYS / FETCH_KEYWORD / GOOGLE_CALENDAR_ID /
               GOOGLE_CALENDAR_ATTENDANCE_ID / CHOUSEISAN_URL(カンマ区切り複数可) / GCP_SA_KEY)
  labola.ts    スクレイパ(日付指定URLを1日ずつ巡回 → LabolaEvent[] に正規化)
  chouseisan.ts 調整さんスクレイパ(window.Chouseisan JSON → 日程ごとの○△×集計。
               複数URLを間隔を空けて取得し、未来日程のない古い出欠表は除外する)
  calendar.ts  Google Calendar API(upsert / 調整さん単独日程 / 消滅イベントの削除)
  types.ts     LabolaEvent 型
  labola.test.ts / chouseisan.test.ts  パーサの単体テスト
  __fixtures__/         実サイト・実ページのフィクスチャ
.github/workflows/sync.yml  毎時7分のcron(workflow_dispatch も可)
```

## 実装ルール

- **JST固定**で扱う: サイトもカレンダーも Asia/Tokyo。ISO文字列は `+09:00` 付きで保持し、
  文字列比較で日時順序を判定してよい(同一オフセットのため)。
- **冪等キー**: カレンダー上のイベントは `extendedProperties.private` の
  `labolaId`(LaBOLA由来)または `chouseisanId`(調整さん由来)で一意にする。
  重複チェックは `events.list` の `privateExtendedProperty` フィルタを使う。
  削除はこの拡張プロパティを持つイベントのみ対象とし、ユーザーが手で作った予定は絶対に消さない。
- **スクレイパは丁寧に**: リクエスト間隔(デフォルト500ms)を空け、ページ送り全件取得はしない。
  日付指定URLでの1日ずつ巡回を基本とする。HTMLパーサを変えたら必ずフィクスチャテストを更新する。
- **機密情報をコミットしない**: `.dev.env`・サービスアカウントJSONはgitignore済み。
  Actionsでは Secrets(`GCP_SA_KEY`, `GOOGLE_CALENDAR_ID`)を使う。
- 型は strict。`null` は明示的に(募集数が取れない場合は null)。
- タイトル先頭の状況マーク(○/△/×)は `formatTitle` で生成する。△のしきい値は
  `LOW_SEATS_THRESHOLD`(デフォルト3)。
- 新機能は `src/` に機能単位のモジュールとして追加し、CLIのサブコマンドまたは
  別ワークフローとして配線する(次の機能は複数予定)。

## 今後の機能候補

- 募集が空きが出たら通知する(LINE/Slack/Discord)
- チームの参加希望を集めて出欠を管理する
- 直近の試合日程のサマリーを定期配信する