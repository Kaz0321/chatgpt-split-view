# 左一覧の非表示からの復元修正

2026-11-08。公開済みmainを基点とした独立ブランチ`codex/fix-sidebar-restore`。進行中の機能ページ対応は含めない。

## 再現できた原因

`pinMasterSidebar`で非表示CSSを追加した後、ChatGPT側の一覧DOMが存在しない状態で再表示すると、対象要素が見つからないため早期returnし、非表示CSSが残る。表示設定だけがtrueに戻っても、新しく生成される一覧が非表示になり得る。

再表示時はDOM探索より前に非表示CSSと古い固定対象を解除するよう修正。開くボタンの探索と、新しく現れた一覧の固定が可能になる。保存済み幅・タブ・入力は変更しない。

## 検証

- 修正前ソースに追加テストを適用して失敗を確認（`hide rule must not survive missing native DOM`）。修正後は成功。
- DOMなし→隠す→表示→開くボタン→置換DOM固定を3回繰り返すテスト。
- 360/768/1844pxを模した状態で隠す→タブ管理を開閉→一覧を戻す。縦バーと復元ボタンが有効で、同じiframeと幅が保持されることを確認。
- 全234自動テスト成功。JavaScript構文とmanifest検査成功。

これらはNodeのDOM代替テストであり、実座標クリック・実レイアウトの確認ではない。実Chromeは以前からタブ接続内部エラー／現在URL確認不能で安全停止しており、実画面で今回の報告と同じ原因かは未確定。安全停止は迂回していない。

実画面復旧後に「左一覧を隠す」と「タブ管理を閉じる」を別々に試し、縦バーが残ること、一覧DOMの再描画後も戻せること、リロード後の復元、元画面／分割の往復を確認する。


## v1.0.2: native hover/collapse state

Observed on authenticated Chrome before the fix: the extension pinned a 340px outer sidebar while the native 52px rail remained visible and the conversation list had `data-sidebar-collapsed`. The native list had zero measured width. Clicking Home temporarily exposed 284px of list content; moving to the extension hide/show control collapsed it again, leaving the forced 340px allocation. Four conversation iframes remained mounted throughout.

The patch reads the native content's collapsed state independently of the forced outer width, allocates only the measured rail width while collapsed, suppresses the legacy fallback over a valid modern rail, and observes collapse/peek/pin attributes plus mutations inside the pinned sidebar. It does not synthesize native clicks, change the user's pin preference or stored sidebar width, or touch conversation drafts. The resize handle is hidden when only the rail is visible.

Regression tests cover closed/expanded/closed and pinned/unpinned semantic states, extension hide/show, native DOM removal/replacement (navigation), and observer batching. These are automated DOM simulations, not claims of authenticated browser post-fix coverage. Direct hover movement is unavailable in the current browser API. Before-fix authenticated reproduction and after-fix source tests must be distinguished.

Validation result: all 236 automated tests pass; syntax/version checks pass. A production-source local browser fixture was prepared, but Chrome could not open the localhost server (connection timeout), so post-fix browser behavior remains unverified. Existing authenticated tabs were not reloaded, preserving their current input.
