# Inference workspace review repairs

Dependent candidate based on PR8 at `17989c043a00f6a9768accbf079485ba002f1b4a`.
The private review source is MSB `13570d535a3afde41b47b4fb1d38d4793c2c3e7c`;
canonical task criteria and disposition remain in MSB. This candidate addresses the two new
inference-workspace findings and both inherited Task009 findings, without merging the draft chain.

## Repaired behavior

- HTTP validation, state augmentation, rendering and serialization finish before success headers.
  Error responses bypass fallible provider/workspace projection; a begun response is closed safely.
  Subprocess regressions verify missing requests, foreign/corrupt previews and a sealed invalid
  page that fails specifically during JSON inference augmentation. They check bounded errors,
  server survival, exact stored-state equality and a subsequent valid request download.
- Per-project browser choices persist active page identities. Automatic fallback excludes historical
  cancelled/stale results, while explicitly selected historical proposals remain inspectable and
  labeled. No page snapshot or acceptance schema is changed. Fresh-context, reload and same-origin
  closed-copy restart checks cover cancelled, base-stale and project-stale imports.
- Retained native/API defaults use explicit selection ledger events, resolving the selected identity
  through its current bundle placement revision. Updating an older unselected round cannot select it.
  A real-control multi-round regression verifies both forms, deliberate selected-page placement,
  reopen/restart and unchanged exact acceptance.
- Retained AI refinement uses an explicit design-only base transport projection. Reference/comparison
  bookkeeping and operational provenance are excluded; nested AI image-need reference hints are
  intersected with exact deliberately included references. Renderable decisions and placed originals
  stay in the projection. The stored base/history/export source is unchanged. Native JSON and injected
  offline API-input tests cover legacy and AI bases, no references and one selected reference.

## Evidence and boundaries

`tests/http-errors.test.ts`, added AI-direction tests, and
`npm run test:browser:review-repairs` exercise these adverse paths. All seven existing browser
workflows remain required; the new regression is included on both CI platforms. Mechanical fixtures
and injected transports remain explicitly labeled. Failing original-source probes and passing repaired
checks are recorded separately in the private return, along with actual head/tree and fresh CI results.
The first local retained foundation run timed out on a detached tab during rapid project switching.
Its final two transitions now wait for the entry/project view and application action to finish before
clicking the next tab. Original comparison, ownership and history assertions remain unchanged;
the initial failure is retained rather than counted as a pass.

The original actual two-round primary-session text exercise is exposed as sanitized, hash-bound
request/result JSON in private MSB for independent inspection, rather than relying solely on an archive
reference. It is not relabeled as fresh repair-session inference, model telemetry or designer approval.

No paid/live provider/native host calls, local executor configuration, account automation, destructive
migration, merge or deployment is part of these repairs. Task009 and Tasks010–013 still require
independent re-review; Task014 runtime measurement and Task006 designer/owner decisions remain separate.
Rollback retains the unmerged dependent candidate and complete closed runtime copies with matching code.
