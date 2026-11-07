# v0.9.3 復帰ボタン

ユーザーの報告は「見えるが押しても戻らない」。実ChromeのgetTabはtimeoutMs内部エラー、対象ウィンドウは最小化状態で実画面のDOMは取得できなかった。Chromeを開く操作では新しい空タブのウィンドウが開いたが、既存のChatGPTページは更新していない。実環境の原因確定とは扱わない。

## 再現と検証
- 親headerにpointer-events:noneを指定すると、旧復帰ボタンのcomputed pointer-eventsもnone。中心(154,24)のelementFromPointはBODY。実座標クリックで元画面のまま。
- 修正後の同じ条件・同じ座標クリックで分割画面とメニューが表示される。ボタン/ホストにpointer-events:autoを指定。
- 別の不具合も確認。header不在の長いmainでは旧配置はtop=1280、bottom=1312（画面高720）で画面外。先頭配置後top=24、bottom=56、クリック対象cgww-return、footer bottom=720。復帰操作成功。
- 自動テスト226件。既存の往復時iframe参照・未送信入力保持試験を含む。再現fixtureはscripts/build-ui-fixture.pyで生成し、index.html（pointer-events:noneのheader）とno-header.htmlを使用する。

実ChatGPTでのクリック、狭幅での今回の復帰ボタン、Chrome拡張の再読み込みは未確認。使用中拡張へのファイル反映と実ブラウザで有効化されたことは区別する。
