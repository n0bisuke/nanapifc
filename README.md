# nanapifc

nanapiフットサルチームのための支援ツール群。

## 現在の機能

### 1. 蒲田個サル → Googleカレンダー自動同期

「銀座deフットサル 蒲田スタジアム」の個人参加イベントを取得し、**2つのカレンダー**に同期します。

| カレンダー | 環境変数 | 内容 |
|---|---|---|
| フットサルのみ | `GOOGLE_CALENDAR_ID` | LaBOLAのイベントのみ(残数・満席を1時間おき更新) |
| 調整さん人数入り | `GOOGLE_CALENDAR_ATTENDANCE_ID`(任意) | コンパクトなタイトル(例: `○募集中 蒲田 / 調整5名○`)+ 説明欄に調整さんの出欠(○△×の人数と名前)。蒲田に対応しない調整さん独自の日程は全天候イベントで追加 |

- **デフォルトで「チーム参加OK」のイベントのみ**(`keyword=チーム` で検索。`FETCH_KEYWORD` で変更可)
- **1時間おきに更新**: タイトルに状況マークと残数(例: `○蒲田個サル 9/19(土)08:30〜 残21名`)
  - **○** 空きに余裕あり / **△** 残りわずか(あと3名以下。`LOW_SEATS_THRESHOLD` で変更可) / **×** 満席・受付終了
- **満席・受付終了・キャンセルを反映**: 満席→`満席`、締切→`受付終了`、サイトから消えたらカレンダーから削除
- 同期範囲: 今日から `SYNC_DAYS` 日(デフォルト31日)
- 調整さんの日程との紐付けは**日付**(イベント開始日 = 日程候補日)。同じ日に複数の候補があれば複数行表示

※ 残数・出欠は最大約1時間前の情報です(実際の予約は必ず[予約サイト](https://yoyaku.labola.jp/r/shop/1047/event/individual/)で確認してください)。

## セットアップ

### 1. Google Cloud 側

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **Google Calendar API** を有効化
3. 「APIとサービス → 認証情報」で**サービスアカウント**を作成し、**JSONキー**をダウンロード
4. Googleカレンダーで新規カレンダーを作成(例: 「蒲田個サル」と「蒲田個サル(出欠付き)」の2つ。2つ目は任意)
5. 作成したカレンダーの「設定と共有」→「特定のユーザーと共有」で、
   サービスアカウントのメールアドレス(`xxx@yyy.iam.gserviceaccount.com`)に**変更権限**を付与
6. カレンダーの「設定」ページに書かれた**カレンダーID**(通常はGmailアドレス形式)を控える

### 2. ローカルで試す

```bash
npm install
cp .dev.env.example .dev.env   # あれば。なければ手で作る
```

`.dev.env`:

```ini
GOOGLE_CALENDAR_ID=フットサルのみのカレンダーID@group.calendar.google.com
GOOGLE_CALENDAR_ATTENDANCE_ID=調整さん人数入りのカレンダーID@group.calendar.google.com
CHOUSEISAN_URL=https://chouseisan.com/s?h=...
GCP_SA_KEY=サービスアカウントJSONの中身(1行にするか、base64)
SYNC_DAYS=31
FETCH_KEYWORD=チーム
```

```bash
npm run sync -- --dry-run   # まず取得結果だけ確認(認証不要)
npm run sync                # 実同期
```

### 3. GitHub Actions で定期実行

このリポジトリをGitHubにpushし、リポジトリ設定で以下を登録:

- **Secrets**
  - `GOOGLE_CALENDAR_ID`: フットサルのみのカレンダーID
  - `GOOGLE_CALENDAR_ATTENDANCE_ID`: 調整さん人数入りのカレンダーID(任意)
  - `CHOUSEISAN_URL`: 調整さんの出欠表URL(人数入りカレンダーを使う場合)
  - `GCP_SA_KEY`: サービスアカウントJSON(base64推奨)
- **Variables**(任意)
  - `SYNC_DAYS`(デフォルト31) / `FETCH_KEYWORD`(デフォルト`チーム`)

`.github/workflows/sync.yml` が毎時7分に実行します。「Actions → sync-kamata-calendar → Run workflow」で手動実行も可能です。

## 開発

```bash
npm run typecheck
npm test
```

詳細な開発ルールは [AGENTS.md](AGENTS.md) を参照してください。