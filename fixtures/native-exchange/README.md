# Authored native exchange samples

These are synthetic protocol fixtures, not native-generated images or executable authority for any
other project. `request.tar` contains the same request as `request.json`; this create fixture has no
source images. `result.json` binds that exact request; `original.png` is its hand-authored64×48 original.
All host/model/seed/usage/cost/provider fields are unknown. BVE rejects importing this result into an
unrelated job. Use `npm run test:native:compatibility` for a fresh end-to-end owned example, closed-copy
inventories and sample output files. No account/image/model/GPU invocation is part of this fixture.

`return-kit.tar` is the additive V1 companion to the **unchanged** `request.tar`. It contains the same
request plus the complete bound result schema, incomplete returned/failed templates, operator-mediated
claim instructions and deterministic offline original-file builder. It grants no invocation. See
[the contract](../../docs/native-exchange.md) for required standard tooling and transfer procedure.
