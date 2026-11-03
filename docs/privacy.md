# v0.8.5 永続保存

再起動復元のため、作業ごとのURL・表示名・順序・幅・退避/選択状態・設定・対応入力欄の未送信テキストをchrome.storage.localのcgww.workspace.*に保存します。閉じた列はmetadataのみとなり下書きを含みません。chrome.storage.sessionには書込み所有者と世代トークンを保持します。外部送信・同期保存・新規権限はありません。作業の保存データはブラウザ終了では削除されません。拡張の削除やブラウザ側の拡張データ消去で失われます。下記の旧版説明より本節を優先します。

# v0.8.1 未送信テキストの保存

ユーザーが求めた再読み込み復元のため、開いている列と退避中の列の対応入力欄にあるプレーンテキストを、同じタブ・同じオリジンのsessionStorageへ保存します。URL・表示名・順序・幅・表示/退避状態・設定・workspace IDも保存します。Chromeの共有設定領域や設定エクスポートへ下書きを入れず、ネットワークへ送信しません。添付ファイル・会話本文・生成中状態は読み取りません。×で閉じると下書きは保存対象から除き、閉じた履歴にはmetadataのみを残します。以下の旧版記述より本節を優先します。

# 保存とプライバシー

この文書は v0.7.1 のソースに基づく説明です。Chrome Web Store の審査済み表明や、実環境でのセキュリティ認証ではありません。

## 拡張が扱うもの

- ChatGPT ページの DOM を参照し、会話リンク・タイトル・レイアウト・sidebar の位置を検出します。既知の親 sidebar と子 iframe の表示を調整します。
- 列の URL、表示タイトル、幅、表示／非表示、選択列、横並びの有効状態を、その ChatGPT タブの sessionStorage キー `cgww.v1.workspace` に保存します。
- 表示設定は chrome.storage.local の `cgww.v1.preferences` に保存します。chrome.storage.sync は使いません。
- 設定の JSON 入出力は6種類の表示設定だけを対象とします。会話本文、URL、タイトル、添付ファイル、下書きのバックアップ機能ではありません。

sessionStorage は拡張専用の暗号化保管庫ではありません。同一 origin のサイト側スクリプトから参照され得ます。ブラウザーのタブ復元などで残る場合もあるため、「閉じれば確実に消える」とは扱わないでください。

本文幅の調整は、既知の会話ラッパーの計算済みCSS・寸法とscrollbar幅を参照します。この寸法処理のためにメッセージ文字列・入力・添付内容を収集・送信することはありません。

純正メニューの表示調整はmenuロール・配置ラッパーと祖先のCSSを参照し、一時的な拡張専用属性を付けます。操作項目の内容・実行結果を収集・保存せず、アーカイブやプロジェクト移動を独自実行しません。

## 通信と権限

manifest の権限は `storage`、content script の対象は `https://chatgpt.com/*` です。動作対象の画面を読み取り・変更できます。履歴全体を取得する browser history 権限、Cookie API 権限、全サイト対象の権限は宣言していません。

拡張コードには独自サーバーへの fetch、分析 SDK、遠隔コードの取得を追加していません。ただし、列の iframe は ChatGPT のページです。ChatGPT の認証・ネットワーク・会話送信・添付処理にはサービス側の仕組みと条件が適用されます。「完全オフライン」ではありません。

この拡張は会話本文をエクスポートしたり、添付ファイルのバイト列を独自に読み出して転送したりしません。ファイルドラッグを並べ替えとして奪わない設計です。更新確認は入力内容を調べず、常に警告します。

## 保存状態を消す際の注意

横並び終了・❌による非表示だけでは保存状態を消しません。拡張の削除で拡張設定を取り除いても、サイト側 sessionStorage まで消えると保証はできません。必要なら未送信内容を保護したうえで、そのサイトの保存データをブラウザー標準機能で整理してください。サイトデータの消去はログアウトなど他の影響を伴う場合があります。

公開 Issue に実会話の URL・タイトル・画面・添付・設定ファイル・認証情報を載せないでください。ダミー会話に置き換えた再現手順を使用してください。


## v0.6の追加ローカル状態

同じChatGPTタブのsessionStorageへ、未保存の新規チャットを区別するフラグ、選択列の位置、オーバーレイ操作ボタンの座標を保存します。複数の新規チャットが同じルートURLでも独立した列として残ります。保存済み会話への移行検出は同一originのURLだけを参照し、メッセージ本文・未送信入力・添付内容は読み取りません。これらの状態をサーバーや別端末へ送信する機能は追加していません。

## v0.8.0 閉じた履歴

閉じた列は最大200件のURL・表示名・幅・新規会話フラグを同じタブのsessionStorageに保存します。会話本文・入力・添付・iframe・document参照は履歴に保存しません。一時退避した列は同じページ内のiframeを保持します。

## v0.8.9 recovery text

Conflicting draft alternatives are stored locally alongside the current draft until explicitly discarded. They are not exported in settings or included in closed-history metadata. The most recently closed pane also retains a text-only undo record in page memory for 30 seconds; closing frees the iframe immediately. That temporary record is lost on expiry, another close, or leaving the page. No attachments, conversation transcript, or generation state are captured by this feature.

## Window handoffs

v0.8.10 stores source workspace ID, conversation URL/title and a random handoff marker in extension-local storage. Current browser tab IDs use session storage. No draft, attachment or transcript is sent between windows. The URL fragment and per-tab session storage identify the detached document; clearing these can remove its integration toolbar association. Handoff records are bounded to 200. No new permissions or device sync are added.
