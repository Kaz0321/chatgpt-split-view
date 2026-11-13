# Native operation audit — v1.0.18 candidate

Date: 2026-11-13. Final automated run: `npm run verify`, 346/346 tests; deterministic package build and `--check` passed. This is a bounded compatibility audit, not a claim that every ChatGPT operation works.

## Evidence levels

- **Code**: reviewed the event, route, layering and document-lifecycle paths.
- **Synthetic**: Node tests execute candidate functions with explicit DOM/state doubles; not browser rendering or service success.
- **Local Chrome fixture**: actual candidate modal-layer functions, browser CSS, hit testing and same iframe/document/composer identity on a localhost mock page. Five automated checks passed; manual open/cancel visually passed. Not ChatGPT E2E.
- **Live old runtime**: existing installed runtime, exact installed version not asserted. Read-only UI opening/dismissal and safe native navigation. Candidate files were subsequently staged in the installed extension directory, but the browser runtime was not activated or reloaded.

## Safe candidate activation attempt

After staging the candidate files, a new disposable Chrome tab opened ChatGPT for a safe service-side check. That tab still loaded the old runtime: the candidate's `#cgww-host[data-cgww-native-modal]` display:none stylesheet signature was absent. Only the disposable test tab was closed. The existing workspace holding unsaved work was not touched, and no extension/global reload or service-side data change was performed.

Candidate ChatGPT E2E remains blocked until the candidate runtime can be safely activated. Files staged on disk are not evidence that Chrome is executing them. The 346 automated tests and local Chrome fixture remain valid candidate checks, but neither is service E2E. Publication remains on hold pending the promised live candidate testing.

## Coverage matrix

| Operation | Old-runtime live observation | Candidate verification | Remaining acceptance |
| --- | --- | --- | --- |
| New project launcher/dialog | Native button opened role=dialog; dialog and backdrop hidden by split board. Original mode showed it; Cancel worked. | Code + synthetic nested/open/close tests + local Chrome modal fixture pass. Chrome fixture preserves iframe, composer and draft. | Candidate on ChatGPT; explicit project creation/save only with a disposable project authorized by its owner. |
| Open existing project home | Project row expands normally; native project menuitem navigates parent to canonical project URL, but board hides destination. | Code + synthetic explicit anchors and native button/menu route adoption pass; project pane uses existing independently persisted newChat route. | Candidate service rendering, project resources and returning to chat. |
| Global search | Native dialog/combobox/listbox opened but was hidden behind board; dismiss worked. | Code + synthetic modal yield, dialog link/New chat bypass and listbox layers pass. | Candidate search-result selection, keyboard and pointer, empty/error results. |
| Settings | Profile Settings navigated to /settings/general-settings below board. | Code + synthetic non-chat route returns to original mode; no loaded frame is removed. | Candidate settings pages and return-to-split; no settings were changed. |
| Profile/account menu | Open and close visible in old runtime. | Existing menu layer tests + dialog bypass regressions pass. | Account switches, billing, logout and permission changes were not exercised. |
| Project row/menu | Expand/collapse, menu open/close passed. Project-home destination was hidden. | Existing menu protections + route adoption tests pass. | Rename, delete, move, project instructions/resources, sharing and invitation commits not exercised. |
| Model selector | One pane selector opened/closed visibly. No model selected. | Event guards and existing embedded-navigation regressions pass. | Candidate selection/response behavior, paid/model-specific controls. |
| Composer file/tools menu | One pane menu opened/closed visibly. No file selected. | Native menu guards, existing file-drag/iframe tests pass. | Upload/download, tool execution, voice/camera/microphone, sending and generation are untested. |
| Conversation menus | Existing layering retained; this audit did not execute data-changing actions. | Menu/listbox propagation tests; title-sync and native-rename tests pass. | Share/archive/delete/move/rename save outcomes and confirmation dialogs need authorized disposable data. |
| Sidebar history / content links | No broad live navigation sweep. | Semantic sidebar scope; body links at x=0/20/100/500 remain native. Modified/new-chat/download and menu controls tested. | Current ChatGPT keyboard shortcuts and all DOM variants. |
| Native navigation inside a pane | Code found stale saved URL in prior implementation. No live draft navigation induced. | Saved-to-saved and supported fresh routes update metadata without src changes. Old draft backup, destination-draft race, unsupported-route capture guard and route promotion/alias tests pass. | Real asynchronous SPA rendering, back/forward and full navigation with disposable drafts. |
| Restoration / branch / title regressions | Existing unsaved original input and provisional branch were preserved during old-runtime audit. | Full suite includes v1.0.15 title, v1.0.16 branch and v1.0.17 lazy restoration regressions. | Candidate service E2E, reload persistence and memory benchmarks not performed. |

## Behavior and constraints

Visible native top-level role=dialog/alertdialog and open HTML dialogs cause temporary **visual suspension**, not workspace disablement or iframe removal. The extension host gets a runtime attribute and a display:none rule; native sidebar pin styles are released. Native focus trapping, backdrop and portal ancestry remain site-owned. The last visible nested dialog must close before chrome returns. Original mode removes watcher, stylesheet and attributes.

Native project-home/created-project route changes are recognized from the actual supported URL, not a project name or guessed ID. Native saved-conversation destinations use normal pane selection. Other native parent destinations switch to original mode, keeping loaded frames. Turning interception off is respected. Already-completed native navigation falls back to original mode if pane creation is declined or limited. By contrast, a directly intercepted click whose extra-pane confirmation is cancelled intentionally stays put, so cancellation cannot trigger destructive iframe navigation.

Parent route observation uses DOM mutations, popstate and hashchange. Pure pushState without any DOM mutation/event is not immediately detected. Pane URL checks also run on existing 1.5-second title synchronization and draft saves; no new timer is added. Known same-conversation/project aliases and fragment-only parent changes do not select another pane; unsupported home mode queries reveal original mode. Unknown layouts/languages and non-semantic overlays remain outside the guarantee. Embedded native dialogs stay within their pane and are not promoted into the parent document.

Draft ownership uses distinct keys for saved conversations, GPT resources, provisional conversations and each fresh route. A changed key conservatively keeps cached text in backups rather than injecting it into another composer, including new/provisional-to-saved promotion. The live composer is never cleared or rewritten by that ownership guard; subsequent input is captured for the destination. Same-key aliases preserve ownership. This intentionally trades some automatic restoration for preventing cross-conversation draft insertion.

The audit never created a project, sent a message, uploaded a file, renamed/deleted/shared anything, selected a model, or granted a permission. No stored user conversation IDs, names or text are included here. The live browser was returned to its prior home/split layout with menus closed; no reload or iframe replacement was used.

## Local browser fixture

From repository root, run `python -m http.server 8766 --bind 127.0.0.1` and visit `http://127.0.0.1:8766/tests/browser/native-modal-fixture.html` in a separate tab. It must show five PASS results. Open the fixture modal, verify visibility and Cancel. Stop the server afterward. This fixture is development-only and excluded from the distribution ZIP.
