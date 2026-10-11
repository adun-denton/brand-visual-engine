# Unused TCP connection shutdown repair

Independent review closed the three chat boundary repairs at
`aa8f1a5eadbd0fe0106e6dcdb794f0618045b811`, but reproduced an inherited shutdown stall:
an accepted connection that had sent no HTTP request retained `server.close()` until the
client disconnected. This R4 candidate accounts for those connections without discarding
admitted request work. The exact result head/tree and OS CI outcomes are pinned in PR10
and the coordinator return. Independent acceptance remains outstanding.

## Behavior and implementation

`src/service/http-drain.ts` tracks sockets at acceptance and outstanding responses and
handler promises separately. Shutdown stops listener admission and flushes/closes sockets
with no active response, including pre-request TCP connections. Active responses can finish
normally; their queued output flushes before disconnect. A five-second transport deadline
disconnects remaining stalled connections. After transport closure, all admitted handler
promises must settle before chat persistence and the workspace close.

The five-second bound applies to transport, not arbitrary asynchronous persistence work.
A handler that never settles can still prevent completion; closing its stores underneath
it would lose the ordering guarantee. Existing provider cancellation, request/header
timeouts, repeated-close identity and the stopping-response guard are retained. The internal
helper's shortened test grace is not an HTTP/API setting. Account/authentication guards,
process defaults, scoped tools and human acceptance are unchanged.

## Regression evidence

Five new real-transport/service tests cover:

- ordinary close and twice-reopened bare TCP controls, zero bytes and repeated-close identity;
- a partially delivered, admitted media upload completed during shutdown, original-byte
  persistence and complete closed-copy restart with byte-identical accepted page export;
- complete delivery of a queued 2 MiB HTTP response during drain;
- deadline cleanup of an incomplete request body while awaiting work after disconnect;
- awaiting asynchronous handler work after its response has already finished.

The existing polling/repeated-close/restart test remains. The retained repair browser workflow
keeps all four historical/selection scenarios and adds an owned zero-byte TCP connection
through each closure. Its final reopen, export, selection and acceptance assertions remain.

Node 24.19.0 build/typecheck, **190** tests (zero failures/skips/cancellations), both smokes,
serialized fixture equality and whitespace checks pass. All nine browser workflows pass
locally with Chromium 143.0.7499.0, including the four retained repair scenarios plus four
unused-connection controls. A first browser launch failed before app interaction because a
cached executable was truncated; restoring the binary from its compressed copy resolved it.
Each completed workflow has a separate full log. Windows/Linux CI runs the same checked-in
suite; read its exact-head outcomes in the return rather than inferring them from local tests.

Reproduce with the commands in `.github/workflows/verify.yml`, or start with:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
node --test tests/http-drain.test.ts tests/chat-http.test.ts
npm test
npm run test:browser:review-repairs
```

Use disposable runtime roots. Keep the preconnection alive until `close()` settles, then
clean up only that probe-owned client. Copy the complete private runtime only after closure.

## Limits and rollback

The independent review's interrupted local browser run remains a failed/incomplete observation,
separate from its passing CI and this candidate's evidence. This repair does not claim R1–R3
caused R4. Actual account/model/image/paid/GPU calls: **zero**. Windows credential ACL evidence,
account eligibility/login, live streaming/resume/interrupt, observed model/usage provenance
and designer acceptance remain separate gates. No merge, deployment or release occurred.

Review the exact returned head independently. Task015 remains in progress. Accepted runtime
rollback is main `8d61b09d21089f64f496c24da4fc671797c81407` plus a matching complete private
runtime backup. Reverting only R4 restores its shutdown defect; reverting R1–R3 also restores
their known defects.
