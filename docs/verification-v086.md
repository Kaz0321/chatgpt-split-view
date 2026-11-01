# v0.8.6 verification

- Live ChatGPT DOM inspected read-only on 2026-11-01: main with `MainContentSurface-EnuIYE MainContentLeftBorder-IFAvO_` had a 1px left border, no shadow. The sidebar itself had no border. A separate PageSurface shadow was observed and is left unchanged.
- Only the embedded hide-sidebar stylesheet removes the main surface left border. Parent sidebar, pane separators, resize handles, outlines, content borders, and persistence code are unchanged.
- Edge fixture using the production FRAME_NAV_CSS and observed class shape: hidden navigation main border 0px; parent main border 1px; quote border 4px; divider 3px; focused main outline 2px. Re-enabling navigation restores main border to 1px.
- Live authenticated user pages were not modified; the installed extension was not reloaded. The reported line is consistent with the observed main border, but its disappearance in an installed live authenticated iframe has not been directly verified.
- Node regression suite: 166 passing tests. Source syntax/manifest checks and deterministic package integrity check pass.
- No new permissions, data schema changes, or browser settings.
