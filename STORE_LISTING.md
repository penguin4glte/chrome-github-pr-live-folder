# Chrome Web Store 掲載情報ドラフト

公開時に [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) へ
入力する内容のドラフトです。

## 基本情報

| 項目 | 値 |
| --- | --- |
| 拡張機能名 | GitHub PR Live Folder |
| カテゴリ | Developer Tools（デベロッパー ツール） |
| 言語 | 日本語 |

## 概要（短い説明 / 132文字以内）

> GitHub の Pull Request を定期取得して Chrome のタブグループへ自動同期します（Arc / Dia の Live Folder 風）。

## 詳細な説明

```
GitHub の Pull Request を Chrome のタブグループへ自動同期する拡張機能です。
Arc / Dia ブラウザの「Live Folder」のような体験を Chrome で実現します。

■ 主な機能
・1分ごと（変更可）に GitHub 検索 API で PR を取得
・「Pull Requests (N)」というタブグループを自動作成し、PR ごとのタブを追加
・クローズ / マージされた PR のタブは自動で閉じる（閲覧中のタブは閉じません）
・PR の更新が新しい順にタブを並べ替え
・読み込み完了後にタブを休止（discard）してメモリを節約
・ポップアップで PR 一覧・最終同期時刻を確認、クリックで該当タブへジャンプ

■ セットアップ
1. GitHub で Personal Access Token を作成（repo / public_repo、または Pull requests: Read）
2. 拡張機能の設定画面でトークンと検索クエリを保存

■ プライバシー
トークンと設定はお使いのブラウザ内（chrome.storage.local）にのみ保存され、
GitHub 公式 API 以外へ送信されることはありません。
```

## 権限の正当化（審査で記入）

| 権限 | 用途 |
| --- | --- |
| `tabs` | PR ごとのタブを開く・並べ替える・休止するため |
| `tabGroups` | PR をまとめるタブグループを作成・更新するため |
| `alarms` | 一定間隔で PR を取得するため |
| `storage` | トークンと設定をローカルに保存するため |
| `host_permissions: https://api.github.com/*` | GitHub API から PR を取得し、トークンを検証するため |

- **単一用途の説明:** GitHub の Pull Request を取得し、Chrome のタブグループへ同期する。
- **リモートコードの使用:** なし（すべてのコードはパッケージに同梱）。

## 公開済みリンク

- リポジトリ: https://github.com/penguin4glte/chrome-github-pr-live-folder
- **プライバシーポリシー URL（審査で登録）: https://penguin4glte.github.io/chrome-github-pr-live-folder/**

## 必要なアセット

- [ ] スクリーンショット 1280x800 または 640x400（1〜5枚、最低1枚必須）★要手動撮影
      例: タブグループ同期中の画面、設定画面、ポップアップ
- [x] 小タイル 440x280 … `store-assets/promo_small_440x280.png`
- [x] マーキー 1400x560（任意）… `store-assets/promo_marquee_1400x560.png`
- [x] アイコン 128x128 … `src/icons/icon128.png`（同梱済み）
- [x] プライバシーポリシー … GitHub Pages で公開済み（上記 URL）

## 公開手順

1. [Developer Dashboard](https://chrome.google.com/webstore/devconsole/) に登録（初回のみ $5 の登録料）
2. 配布用 zip を生成（`src/` の中身を zip 化。`manifest.json` がルートに来るようにする）
   ```sh
   ./scripts/package.sh   # github-pr-live-folder-v<version>.zip を出力
   ```
   作成された `github-pr-live-folder-v<version>.zip` を「新しいアイテム」からアップロード
3. 上記の説明・スクリーンショット・カテゴリ・言語を入力
4. プライバシー タブで「単一用途」「権限の正当化」「データ使用」を記入し、
   プライバシーポリシーの URL を登録
5. 「審査のために送信」→ 審査通過後に公開
