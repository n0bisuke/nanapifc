# ROADMAP — 今後の機能計画

最終更新: 2026-09-16

## 前提(現状の仕組み)

- LaBOLA(蒲田個サル)→ Googleカレンダー2種へ同期。毎時実行(GitHub Actions `sync.yml`)
- 調整さん(chouseisan)の出欠を集計し、出欠付きカレンダーに反映
- 調整さんURL・SAキー等は **GitHub Secrets のみ**に置く(publicリポジトリのため、
  コード・README・Variableには書かない)

## Phase A: 調整さん複数URL対応(基盤)— **完了(2026-09-16)**

- `CHOUSEISAN_URL`(Secrets)にカンマ区切りで複数URLを設定できるようにする
- 未来の日程が1つもない調整さんは自動的に除外(古いものを消し忘れても害なし)
- カレンダーへの反映・削除判定はURLをまたいで labolaId / chouseisanId で冪等に処理
- Phase B・C のどちらにも必要な基盤のため最初に実装

## Phase B: 調整さんURLの自動検出(LINE連携)

方針: 新しい調整さんのURLは **LINEグループに貼られる**前提で、ボットが自動検出する。

```
LINEグループにURLが貼られる
  → グループ内のボット(Messaging API)がメッセージをWebhookで受信
  → Webhook受信(Google Apps Script doPost, 無料)が chouseisan.com のURLを抽出
  → GitHub API でリポジトリ変数/Secrets相当を更新し、syncをトリガー
  → 毎時のsyncが新しい調整さんを取り込む
```

必要な作業:

1. LINE Developers Console でMessaging APIチャネル作成(公式アカウント1つ)
2. ボットをLINEグループに招待
3. 3つの認証情報をSecretsに保存: `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `LINE_GROUP_ID`
4. Webhookエンドポイント(GAS)のデプロイ(コードは `line-webhook/Code.gs` としてリポジトリ管理)
5. GASからGitHub APIを叩くためのPAT(PATはGASのスクリプトプロパティに保存。リポジトリには置かない)

セキュリティ:

- LINEのwebhook署名検証(x-line-signature)を必ず行う
- メンバー名が見える調整さんURLは**コード・ドキュメント・Variableに書かない**
- publicリポジトリなので、ログにもURL・メンバー名を出力しない

## Phase C: 通知(LINE Push API → グループ)

- **空き・締切通知**: 残数がしきい値(例: 残3名)を切った/満席になった/締切が近づいた(受付期限2日前など)ときにPush送信。状態は前回実行時の差分で検知する(GitHub Actionsキャッシュまたはリポジトリ内の状態ファイルに前回値を保存)
- **出欠変化アラート**: 調整さんの○の人数が前回より減った/未回答者が多い日を検知して通知
- 通知文面: 短文(`⚽9/26(土)19:30 残1名!` 等)
- LINE Push APIの無料枠は月200通 → 通知は1日数件程度なら問題なし

## 未決事項

- 通知のしきい値や投稿タイミングの細かい仕様
- 出欠変化アラートの「前回値」保存先(GitHub Actions cache / リポジトリのJSON / Calendar APIの状態差分)