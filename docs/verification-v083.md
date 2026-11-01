# v0.8.3 verification

Live read-only ChatGPT DOM inspection found a 340px outer sidebar and 348px scroll width: an absolutely positioned 16px handle starts at x=332. Default/reset now reserves 348px; existing saved widths remain intact. Parent pinning keeps overflow auto, so narrower custom widths scroll inside their allocated region rather than covering conversation panes.

Edge fixture replicating the 340px content and native handle confirmed clientWidth >=348 and scrollWidth <= clientWidth at reset. Hiding sets the native sidebar display to none and the workspace left edge to exactly 0. The floating restore control remains reachable. Restoring retains 380px and the locked state. With all panes parked and sidebar hidden, an actual page reload retained both states, the floating menu opened, and sidebar plus parked pane could be restored without duplicates. v0.8.2 geometry checks (0/6/12px offsets, 768px body, manual/reset width, stable iframe) also passed.

Automated tests include hidden width zero, preserved width/lock and all-parked state, and existing regressions. This is rendered synthetic-page QA plus read-only live measurements; the installed extension has not been updated or tested on the authenticated live page.
