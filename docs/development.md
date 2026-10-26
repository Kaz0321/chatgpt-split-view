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

- `extension/manifest.json`: MV3 の権限・対象サイト・popup／options
- `extension/core.js`: URL・設定・順序の純粋関数
- `extension/workspace.js`: ページ側 UI、sidebar、iframe、popup メッセージ
- `extension/popup.*`: 頻繁に使う操作
- `extension/options.*`: 低頻度設定と表示設定 JSON
- `extension/background.js`: options／検証済み会話URLへのメッセージ処理
- `tests/*.test.cjs`: Node の89回帰試験
- `scripts/`: 構文／manifest／テスト／配布 ZIP の検査

拡張本体は `extension/` 内で完結します。manifest・HTML・service worker が参照する相対パスは、そのディレクトリがChrome拡張のルートになることを前提にしています。repo直下は開発用です。

## 配布 ZIP

`scripts/package.py` は明示した実行ファイルと文書だけを `dist/chatgpt-split-view-v0.6.0-candidate.zip` に入れます。`extension/` の10実行ファイルはZIP直下へ配置し、`manifest.json` が直下にある展開フォルダーをそのまま読み込める形にします。文書はrepo内の相対パスを保ちます。Git metadata、テスト、ログ、画像、環境設定、公開サイトの配備資材を混ぜません。ZIP内時刻・ファイルモード・順序を固定し、無圧縮にすることで同一ソースから同一バイト列を生成します。`--check` は既存 ZIP が現ソースと一致するかを検査します。

ZIP はリポジトリ全体のソース ZIP と異なり、開発用テスト／スクリプトを含みません。開発・再テストにはこのリポジトリの checkout を使ってください。

## CI

GitHub Actions は push／pull_request／手動実行で、ソース検査、89件のテスト、ZIP生成と整合性確認だけを実行します。権限は contents:read、外部 action は固定 commit、checkout の資格情報は残しません。リリース公開、拡張インストール、実ChatGPT操作、サイト配備を自動実行しません。

参照 action は [checkout v4.2.2](https://github.com/actions/checkout/releases/tag/v4.2.2) と [setup-node v4.4.0](https://github.com/actions/setup-node/releases/tag/v4.4.0) です。公開時の remote CI 成功は別途確認してください。

## ブラウザーでの受入

実拡張を扱える検証環境で、ダミー会話を使って次を確認します。未送信の実データを入れないでください。

1. popup開始→終了→再開、設定保存、接続できないページでのエラー。
2. 親を固定したまま大／小のwindow幅を往復し、親／子sidebarを分離。
3. 会話を10列開き、先頭／末尾への横スクロール、幅320／768／等分。
4. 逆方向・離れた列の並べ替えと Alt＋左右、下書き・スクロール保持。
5. 各列の×／復帰、更新取消、確認後の対象1列だけ更新。
6. 先頭／中間／末尾、並べ替え後へのダミーファイルDnD。対象外に入らないこと。
7. ChatGPTの遷移・再描画・認証変更を含む中断／再開。

合成テストの合格でこの実機受入を代替しないでください。

## 名前と互換性

公開名と manifest の表示名は ChatGPT Split View です。既存設定との互換性を保つため、内部の `cgww` 保存キー、設定 JSON の kind、旧名を含む設定エクスポートファイル名は変更していません。これらはユーザー情報やアカウント識別子ではありません。

## ライセンスと来歴

このプロジェクトは [MIT License](../LICENSE) で公開します。Copyright (c) 2026 Kaz0321。許諾条件と無保証条項は LICENSE の本文を参照してください。

ChatGPT Wide Workspace v0.3.0 の拡張ソースを基に開発し、ChatGPT Split View として公開しています。各版の変更は[変更履歴](changelog.md)を参照してください。

元資材には LICENSE が含まれておらず、公開時にプロジェクト所有者の明示的な選択に基づいて MIT License を追加しました。第三者由来部分の有無を網羅的に検証したという表明ではありません。第三者の権利に関する問題が判明した場合は、該当部分と出典を確認して扱ってください。

実行時の外部 npm 依存はありません。CI が参照する GitHub Actions は各提供元の独立したソフトウェアであり、本リポジトリにそのコードを取り込んでいません。


## v0.6の操作入口

ページ内オーバーレイはworkspace.js内の閉じた関数を直接呼び出し、Webページ向けpostMessage APIや追加の権限は導入しません。拡張popupの送信元認可は従来どおりです。

新規会話ルートは`Core.newChatUrl`で通常会話の`chatUrl`と区別します。`normalizeSessionPanes`は`newChat:true`付きのルートを重複排除せず残し、従来の未設定列・保存済み列とも互換です。選択復旧はactiveIndexを優先し旧activeUrlへフォールバック。新規列の保存済みURL検出はiframeのload／既存DOM observer経由で行い、iframe.srcを書き換えません。ルートだけが変わりDOMイベントが発生しないケースは検出保証外です。

再現確認には、ブラウザーの拡張ボタンを使わず、ページ内メニューの開始／Esc／外側クリック、位置移動／狭幅、元画面の native new chat 通過、分割中の親リンク／子ボタンで新規を連続追加、模擬保存済み経路への移行と下書き保持を含めます。

## 表示・ナビゲーションの仕様

- manifestの最低Chromeバージョンは114。全対応版での互換性を保証する指定ではありません。一般的な読み込み手順は[Chrome公式資料](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)を参照してください。
- 列の最小幅は320px。最大幅は親画面から検出し、検出できない場合は暫定値920pxを使います。等分でも最小幅を守り、多列は横スクロールします。
- 元画面への切替は列のiframeを非表示にし、親固定と履歴／新規操作の介入を停止します。分割へ戻ると既存文書を再利用します。×も非表示操作で、メモリを即時解放しません。
- オーバーレイは常設の上段領域を使わず、位置をタブ内で保持します。履歴や他の操作と重なる場合は移動が必要です。ドラッグに加えて、つまみへフォーカスして矢印キーでも移動できます。
- 新規操作は標準の`https://chatgpt.com/`と認識可能なボタンが対象。修飾キー付きクリック、ダウンロード、外部リンク、一時チャット等のモード付きURL、Project/GPT固有の新規操作は元動作を残します。旧版の未設定列がある場合、履歴の会話はそこを使用します。
- アプリモードではcontent scriptが実行されることが前提です。実拡張のアプリモードE2Eは未検証です。[検証範囲](verification.md)と[保存・権限](privacy.md)を参照してください。

## 旧配置からの移行

リポジトリ直下を読み込んでいた版から移行する場合、現在の読み込み先は`extension/`です。別フォルダーから読み込むと拡張IDが変わる場合があります。オプション画面のJSON入出力で移せるのは表示設定だけで、会話URL・タイトル・下書きは移しません。

不具合時はページ内の「元画面」へ切り替えるか拡張を無効化してください。旧版へ戻す前にも未送信内容を控えてください。
