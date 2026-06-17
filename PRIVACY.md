# プライバシーポリシー / Privacy Policy

**拡張機能名 / Extension:** GitHub PR Live Folder
**最終更新 / Last updated:** 2026-06-17

## 日本語

本拡張機能（GitHub PR Live Folder）は、ユーザーのプライバシーを尊重します。

### 収集・保存する情報

- **GitHub Personal Access Token / 検索クエリ等の設定値**
  ユーザーが設定画面で入力したトークンおよび設定は、`chrome.storage.local` を
  使用して**お使いのブラウザ内にのみ**保存されます。外部サーバーへ送信・収集することはありません。
- 開発者を含む第三者が、これらの情報にアクセスすることはありません。

### 情報の送信先

- 入力された GitHub トークンは、Pull Request の取得・トークン検証の目的に限り、
  **GitHub の公式 API (`https://api.github.com`) に対してのみ** HTTPS で送信されます。
- それ以外の外部サービス・解析ツール・広告ネットワークへの送信は一切行いません。

### 取得するデータの用途

- GitHub API から取得した Pull Request 情報は、Chrome のタブグループへの同期と
  ポップアップ表示にのみ使用し、ブラウザ外には保存・送信しません。

### データの削除

- 拡張機能をアンインストールすると、`chrome.storage.local` に保存された
  すべての設定・トークンは削除されます。
- 設定画面からトークンを空にして保存することでも削除できます。

### お問い合わせ

ご質問は本拡張機能の公開元までお問い合わせください。

---

## English

This extension (GitHub PR Live Folder) respects your privacy.

### Information stored

- **GitHub Personal Access Token and settings** you enter in the options page are
  stored **only within your browser** via `chrome.storage.local`. They are never
  transmitted to or collected by any server controlled by the developer or any third party.

### Where data is sent

- Your GitHub token is sent over HTTPS **only to the official GitHub API
  (`https://api.github.com`)**, solely to fetch your pull requests and to validate the token.
- No data is sent to any analytics, advertising, or other third-party service.

### How data is used

- Pull request data fetched from the GitHub API is used only to sync Chrome tab
  groups and display the popup. It is not stored or transmitted outside your browser.

### Data deletion

- Uninstalling the extension removes all settings and tokens stored in `chrome.storage.local`.
- You can also clear the token by emptying the field and saving in the options page.

### Contact

For questions, please contact the publisher of this extension.
