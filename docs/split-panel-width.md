# Split panel width: v1.0.3

## Evidence and scope

Authenticated Chrome: all four conversation frames measured 824px before this change. The first frame's overview control opened a small floating output popover, not a split panel. Its app shell kept `data-app-shell-trailing-sidebar-visible="false"`. We closed that popover and left inputs unchanged. This is a negative detection example, not successful review testing.

Automatic detection requires a visible, nonzero native app-shell with `data-app-shell-trailing-sidebar-visible="true"`. The attribute is observed in the real DOM; its true state on the user's review UI has not been verified. No text matching, guessed URLs or generic dialog selectors are used. Unrecognized canvas, code review, PDF/file previews can use the explicit per-pane width toggle. Cross-origin frame contents are not inspected.

## Behavior

Runtime WeakMap state keeps expanded width separate from saved pane width/autoWidth and settings. Closing a detected panel resets runtime overrides. Manual expansion without recognized panel detection is closed using the same button. Document/route replacement clears overrides; folded frames retain temporary adjustments. The per-pane override runs after equal-width calculation, so sibling widths remain unchanged. Layout inspection skips expanded documents so their widths cannot raise the global conversation cap. Native wrapper styles are restored while expanded.

Normal expansion uses the available scroller width clamped to 1100–1800px, without shrinking a wider base column. Temporary manual drag accepts 320–2400px. Narrow windows retain readable width and use horizontal scrolling. Persistent preferences, groups and drafts are unchanged.

## Verification

241 automated tests pass, including normal/expanded/restored widths, independent sibling width, equal-width preference retention, manual override/reopen, route/document reset, cross-origin transition, fold/unfold, iframe and draft identity, button pressed state, hidden/zero-size false positives, and live layout refresh integration. Existing persistence and navigation regression suites pass.

A production-source local UI fixture was generated for browser testing. Chrome connection to localhost timed out, so post-change rendered behavior, actual review open/close, canvas/file variants, keyboard screen-reader output and responsive native breakpoints remain unverified. This limitation is not represented as a pass. The installed files can be updated without reloading the user's active conversations; activation requires extension and page reload.


## v1.0.4: reproduced document review mismatch

The user opened a real document review in Chrome. Its app shell retained trailing-sidebar-visible=false while a visible role=tabpanel element had data-app-shell-tab-panel-controller=right, width484 and height930. This independently rendered right controller was missed by v1.0.3. The installed page had the wide button; clicking it increased the iframe to1454px, verifying that width application worked and detection was the missing step.

Added the observed right tabpanel selector alongside the original trailing sidebar signal. Hidden, aria-hidden and zero-size panels do not trigger widening. The existing mutation observer now includes the controller and aria-hidden attributes. Actual automatic open/close after extension reload remains a separate pending check; manual widening in the user's review is verified. No document content or drafts were edited.
