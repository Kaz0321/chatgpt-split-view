# v0.8.7 background-band verification

## Reproduction evidence

Read-only inspection of authenticated ChatGPT on 2026-11-01 found an app-shell frame with inline `--app-shell-navigation-rail-width:52px`. Hiding the aside does not clear this value. The workspace `::before` starts at that offset, and its direct `PageSurface-g2Llyi FullHeightPageSurface-Spy7z1` child is a transparent, absolute, rounded shadow layer at x=52. v0.8.6 removed a different main border; it did not remove this decoration.

`node scripts/visual-rail-qa.cjs` serves http://127.0.0.1:8881. It uses the observed DOM hierarchy, flex sizing, inline rail width, workspace pseudo-background and PageSurface shadow. The before column uses the production stylesheet up to the v0.8.6 boundary rule; the fixed column uses the complete current stylesheet. Labels, text and sidebar contents are synthetic. This is a focused DOM/style reproduction, not a captured authenticated iframe or a full ChatGPT clone.

## Visual checks in Edge

- Before changing code, the fixture showed the 52px vertical shaded band even with the v0.8.6 border fix. Both columns initially reproduced it.
- After the fix, screenshots of before/after showed the band and rounded shadow on the left baseline and a continuous body background on the right. Light and dark checked at 320px and 620px.
- Computed fixed main x=0, width=320; background remains rgb(252,252,252). Workspace pseudo left=0 and top-left radius=0; decoration display=none.
- With embedded navigation shown, native pseudo left=52px, sidebar width=180px and decoration display=block remain. Screenshot confirms sidebar and body background remain intact.
- The correction is inside the existing iframe-only hideFrameSidebar style. The parent document, pane separator/resize code, draft/persistence code and outline rules are unchanged. Existing style-toggle regression verifies complete stylesheet removal on show; cross-origin and parent-independent application regressions remain passing.

## Validation and limits

166 Node tests pass; syntax/manifest checks and deterministic ZIP integrity pass. No new permissions. User tabs, browser theme and installed extension were not changed. Screenshots were inspected through the browser tool. Live user-reported installed-extension rendering remains unverified; the fixture reproduces the observed 52px shadow mechanism, not every possible ChatGPT variant.
