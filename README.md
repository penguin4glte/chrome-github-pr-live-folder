# GitHub PR Live Folder

Arc / Dia ブラウザの **Live Folder** 風に、GitHub の Pull Request を定期取得して
Chrome の**タブグループ**へ自動同期する拡張機能です。

- 1分ごと（変更可）に GitHub の検索 API で PR を取得
- 「Pull Requests (N)」というタブグループを自動作成し、PR ごとのタブを追加
- クローズ / マージされた PR のタブは自動で閉じる（アクティブ中のタブは奪いません）
- PR の更新が新しい順にタブを並べ替え
- 読み込み完了後にタブを休止（discard）してメモリを節約
- ポップアップで PR 一覧・最終同期時刻を確認、クリックで該当タブへジャンプ

## インストール

1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `src/` フォルダを選択

## セットアップ

1. GitHub で [Personal Access Token](https://github.com/settings/tokens) を作成
   - Classic: `repo` スコープ（公開リポジトリのみなら `public_repo`）
   - Fine-grained: 対象リポジトリの **Pull requests: Read** 権限
2. 拡張機能アイコン → 「設定」を開き、トークンと検索クエリを保存
   （「接続テスト」でトークンの有効性を確認できます）

### 組織のプライベートリポジトリにアクセスする場合

- 組織が **SAML SSO** を使っている場合は、トークン作成後に
  [トークン一覧](https://github.com/settings/tokens) で該当トークンの
  「Configure SSO」から対象組織を **Authorize** してください
- Fine-grained token の場合は、Resource owner に組織を選択します
  （組織側の設定によってはオーナーの承認が必要です）

トークンが無効・失効するとバッジに `!` が表示されるので、設定画面で更新してください。

### クエリの例

| 目的 | クエリ |
| --- | --- |
| 自分にレビュー依頼が来ている PR | `is:pr is:open review-requested:@me` |
| 自分が作成した PR | `is:pr is:open author:@me` |
| 組織全体のオープン PR | `is:pr is:open org:your-org` |
| 特定リポジトリの PR | `is:pr is:open repo:owner/repo` |
| 自分が関わっている PR | `is:pr is:open involves:@me` |

GitHub の [検索構文](https://docs.github.com/ja/search-github/searching-on-github/searching-issues-and-pull-requests) がそのまま使えます。
`draft:false` を足せばドラフト PR を除外できます。
クエリに `is:pr` がない場合は自動で付与されます（Issue が混ざるのを防ぐため）。

## 動作の仕組み

- `chrome.alarms` で1分ごとに Service Worker を起動し、
  `GET /search/issues` で PR を取得します（認証時のレート制限は 30 req/分なので余裕があります）。
- ブラウザ起動直後はセッション復元（前回のタブグループの復元）を待つため、
  初回同期を30秒遅らせます。再起動でグループ ID が変わっても、前回同期した
  PR タブの内容とグループ名から既存グループを見つけて再利用します。
- グループ内の「PR ページ以外のタブ」には触りません。グループに手動で他のタブを
  入れても閉じられることはありません。閲覧中のタブも閉じません
  （マージ済み PR を読んでいる間は残り、フォーカスを外すと閉じられます）。
- 検索 API がタイムアウトして部分的な結果を返した場合（`incomplete_results`）は、
  タブの削除をスキップして誤削除を防ぎます。

## 制限事項

- Chrome のタブグループ API の制約上、Arc のようにタブへ「Approved」などの
  サブテキストは表示できません（ポップアップ側で作者・Draft 表示を確認できます）。
- 空のタブグループは作れないため、該当 PR が 0 件のときはグループ自体が消えます。
