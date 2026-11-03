# v0.8.8 verification

The normal sidebar path passed forceNew=true to addPane, bypassing its existing-URL check. The empty-last-column branch also ran before checking existing conversations. Closed history and workspace restoration permitted duplicates.

The shared identity is conversation ID for /c/, /g/g-*/c/ and /project/*/c/ routes. Local threads have a separate namespace; root/new-chat URLs have no identity. URL validation remains on the existing allowlist. Existing panes are selected and unparked without changing width, title, order, iframe or draft. Shift and explicit URL-add no longer bypass identity checks. A new draft that has acquired a conversation URL is recognized from its same-origin frame before observer synchronization.

Restoration keeps the first conversation position and width, merges visibility and a missing draft, and remaps selected-pane indices. Conflicting unsent text becomes an independent new-chat draft instead of being discarded. Blank/new chats remain distinct. Closed metadata remains available; reopening an already-present conversation selects it and consumes that history entry.

Validation: 174 Node tests, including alias/UUID/query identities, forced and blank-fill paths, parked iframe identity, history at the pane limit, draft URL acquisition, restoration idempotence, conflicting drafts, and durable active-index remapping. Source/manifest and deterministic ZIP checks pass.

In-app Chromium browser fixture used real workspace/core/drafts/layout code with storage adapters and local synthetic iframe contents. The run reported PASS for same iframe identity, alias reuse, parked restore, history and two distinct new drafts. Reload retained one Fixture conversation and independent blank chats. Edge control was unavailable; no authenticated live ChatGPT/installed extension test was performed. No new permissions, installed-extension updates or changes to ordinary user tabs.
