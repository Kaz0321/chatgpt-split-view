# 開発と再現手順

## 必要なもの

- ソースチェックとテスト: Node.js 24。ローカル確認は24.22.1。
- ZIP作成: Python 3。ローカル確認は3.12.14。
- 外部 npm／Python 依存なし。npm install は不要。

ソース checkout のルートで実行します。

```sh
npm run verify
npm run package
npm run package:check
```

Windows などで Python が `python` 名の場合は `python scripts/package.py` と `python scripts/package.py --check` を使えます。Node テストのファイル列挙はスクリプト内で行い、シェルの glob に依存しません。

## 構成

- `manifest.json`: MV3 の権限・対象サイト・popup／options
- `core.js`: URL・設定・順序の純粋関数
- `workspace.js`: ページ側 UI、sidebar、iframe、popup メッセージ
- `popup.*`: 頻繁に使う操作
- `options.*`: 低頻度設定と表示設定 JSON
- `background.js`: options／検証済み会話URLへのメッセージ処理
- `tests/*.test.cjs`: Node の69回帰試験
- `scripts/`: 構文／manifest／テスト／配布 ZIP の検査

## 配布 ZIP

`scripts/package.py` は明示した実行ファイルと文書だけを `dist/chatgpt-split-view-v0.5.0-candidate.zip` に入れます。Git metadata、テスト、ログ、画像、環境設定、公開サイトの配備資材を混ぜません。ZIP内時刻・ファイルモード・順序を固定し、無圧縮にすることで同一ソースから同一バイト列を生成します。`--check` は既存 ZIP が現ソースと一致するかを検査します。

ZIP はリポジトリ全体のソース ZIP と異なり、開発用テスト／スクリプトを含みません。開発・再テストにはこのリポジトリの checkout を使ってください。

## CI

GitHub Actions は push／pull_request／手動実行で、ソース検査、69件のテスト、ZIP生成と整合性確認だけを実行します。権限は contents:read、外部 action は固定 commit、checkout の資格情報は残しません。リリース公開、拡張インストール、実ChatGPT操作、サイト配備を自動実行しません。

参照 action は [checkout v4.2.2](https://github.com/actions/checkout/releases/tag/v4.2.2) と [setup-node v4.4.0](https://github.com/actions/setup-node/releases/tag/v4.4.0) です。公開時の remote CI 成功は別途確認してください。

## ブラウザーでの受入

実拡張を扱える検証環境で、ダミー会話を使って次を確認します。未送信の実データを入れないでください。

1. popup開始→終了→再開、設定保存、接続できないページでのエラー。
2. 親を固定したまま大／小のwindow幅を往復し、親／子sidebarを分離。
3. 会話を10列開き、先頭／末尾への横スクロール、幅320／768／等分。
4. 逆方向・離れた列の並べ替えと Alt＋左右、下書き・スクロール保持。
5. 各列の❌／復帰、更新取消、確認後の対象1列だけ更新。
6. 先頭／中間／末尾、並べ替え後へのダミーファイルDnD。対象外に入らないこと。
7. ChatGPTの遷移・再描画・認証変更を含む中断／再開。

合成テストの合格でこの実機受入を代替しないでください。元資材の古いPythonブラウザーテストは旧UIに依存し、今回の公開セットには含めていません。

## 名前と互換性

公開名と manifest の表示名は ChatGPT Split View です。既存設定との互換性を保つため、内部の `cgww` 保存キー、設定 JSON の kind、旧名を含む設定エクスポートファイル名は変更していません。これらはユーザー情報やアカウント識別子ではありません。
