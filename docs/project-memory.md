# Persistent project continuation

Project memory is an optional, chat-free navigator over canonical evidence. Open **Project memory /
Continue** in either visual layout, choose this page or the whole project, and load saved evidence.
The page index includes exact cross-page sources without assigning them to the current page.
Selection, an imported image, and a successful synthetic receipt never imply design acceptance.

To hand work over, inspect an exact source, optionally attach its reference to a note draft, and
explicitly **Save handoff note**. A note is human intent, not a tool instruction, Brand rule, execution
grant or task status. Edit uses the displayed exact revision; a conflicting save preserves the draft.
Load the current note before explicitly choosing which revision to edit. Switching pages/projects
retains session drafts separately; closing the browser discards unsaved drafts.

**Create frozen capsule** saves an immutable snapshot. Inspect its currency separately. **Refresh into
new capsule** creates another snapshot with a link to the original; the original remains byte-stable.
Capsule writes/reads/downloads do not become source evidence or change their own currency. Canonical
notes, source revisions, selections, specifications, durable outcomes, and acceptance changes can
change relevant currency. `changed` means the relevant derived evidence digest differs; the per-source
list distinguishes changed versions, missing/corrupt records and unavailable media. `unavailable`
means a current comparison could not be computed; it never means current.

Review the displayed scope/content preview before **Download previewed JSON**. The JSON contains
supported evidence summaries, exact references/integrities, known workflow events, canonical accepted
pointers and explicit coverage. It includes neither media bytes nor chat, accounts, credentials, host
paths or current-process delivery caches. It is not an archive, import/restore package, render export
or transmission to another service. Raw human-entered note/intent text is data; readers must never
interpret it as tool authority. Requested characteristics remain requests, not observed measurements.

## Authority and storage

| Source | Role | Memory treatment |
| --- | --- | --- |
| Kernel packets, exact media and ledger | Canonical facts | Checked identities/integrities; explicit unavailability |
| Canonical accepted-slot pointers | Acceptance | Separate from selection and receipt success |
| V01 selections/specs/batches | Canonical exploration intent/outcomes | Exact scope and source closure; synthetic registration stays non-executable |
| V03 execution records/receipts | Canonical reservations/call accounting/results | Offline provenance; partial and historical outcomes retained |
| Active calls/pending delivery/error cache | Process-only observation | Remains in Execution panel; never frozen as durable evidence |
| Approved Brand context | Scope-bound context | Approved values only, separate from each spec's actual influence |
| `project-handoff-note` | Versioned human intent | Explicit save, optimistic revision, immutable scope; old text preserved |
| `project-continuation-capsule` | Derived navigation snapshot | Immutable; refresh creates a new ID; cannot authorize any operation |

Both new kinds use existing `work-record` packets in `kernel.sqlite` with strict schemas, semantic-kind
immutability and exact dependency closure. No SQLite version change, parallel database, migration,
provider, summarizer or persistent queue is introduced. Existing accepted records, media, exports,
V01 synthetic-only semantics, V02 draft ownership and V03 interruption paths remain authoritative.
Current-policy references are frozen at their stated version, never silently resolved to latest.
A persisted running/reserved marker is unresolved evidence, not proof that a process is still running.
An expired/revoked canonical grant remains subject to V03 authorization; a capsule carries no grant.

## Bounded local routes

Existing host/origin protections cover all routes; existing visual token is required for writes.
All reads require a project owner and exact pinned references. Approved cross-project Brand reads
require an actual attachment or a frozen specification in that project. Arbitrary foreign reads reject.

| Route under `/api/v1/visual/memory/` | Input / result |
| --- | --- |
| GET `state` | `project`, optional `scope`/`scopeVersion`, `offset`/`limit`; bounded saved notes/capsule references, totals and omissions |
| GET `index` | Same scope/paging; deterministic evidence page, whole-index digest, total/event coverage and next offset |
| GET `evidence` | `project`, `id`, `version`, optional expected `integrity`; exact sanitized evidence or explicit missing/corrupt status |
| GET `capsule` | Exact capsule reference; frozen snapshot, currentness and content preview |
| GET `download` | Exact capsule reference; deterministic schema-valid JSON attachment named from generated capsule ID |
| POST `note` | `{projectId,input:{expected,note}}`; null creates a new note, exact revision edits it |
| POST `create` | `{projectId,input:{scope,previous}}`; optional previous capsule creates explicit refresh lineage |

Offsets are stable for an unchanged index; compare its digest before combining pages across concurrent
writes. Histories include all supported relevant versions, not only latest heads. Unsupported canonical
kinds are counted explicitly. JSON summaries omit unsupported payloads rather than dumping raw records.
Damaged project-owned primary records remain visible with unknown page scope; their identity is not
assigned to the active page. Corrupt or missing-version foreign identities reject. Storage read
failures remain unavailable read errors, not fabricated corruption outcomes.
Index responses retain the whole-source digest and therefore are pagination envelopes, not standalone
`MemoryIndex` snapshots; only a complete saved/downloaded snapshot round-trips that schema.

Implementation bounds are limits, not product defaults: 4096 primary packet versions/closure entries
and relevant events; 2048 snapshot entries; 50 entries or saved records per page; 4000 note characters;
16 exact links per note; 256 KiB exact-evidence response; 2 MiB index page/download/snapshot. Oversized
snapshots/pages reject before saving or returning partial selected evidence. Large masks or histories
can exceed these bounds; media archival/import and larger-source chunking are deferred. Capsule
bookkeeping is excluded from primary inventory bounds so creating a capsule cannot itself invalidate
its source comparison. Saved-record listing has its own bounded inventory. No product layout or attempt
count default is selected by this slice.

## Verification and rollback

Use Node 24.19.0 and `npm ci --ignore-scripts`, typecheck, full tests, build, both smokes, fixture
serialization/diff checks, and the visual/execution/memory browser gates. A preinstalled local browser
can be supplied through `BVE_CHROMIUM_EXECUTABLE`; CI uses its normal Playwright browser installation.
`BVE_EVIDENCE_DIR` selects a disposable evidence directory and `BVE_CANDIDATE_COMMIT` labels the head.
Fixtures prove interaction and deterministic fresh-reader navigation, not actual model usefulness or
image generation. No live account/model/GPU call is needed or authorized.

Rollback uses an isolated prior checkout and a complete, closed matching runtime copy. Never downgrade
an evolved runtime root in place or selectively delete note/capsule history or media. Revert code only
within a separately authorized review/repair. Canonical task status and independent acceptance remain
with the coordinator; local image binding/generation stays deferred until cycle end.
