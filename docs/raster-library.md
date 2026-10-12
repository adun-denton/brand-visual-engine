# Project-local whole-raster Library and export

With chat closed, focus one raster in either visual layout and choose **Add whole raster to Library**
or **Export whole raster**. Whole-image actions remain explicit even when region or multiple selections
exist. Crop, transformation and batch export are unavailable; Build as HTML remains a later process.
Export does not require a Library save or acceptance.

The optional **Project Library / Raster export** surface lists saved versions, previews exact original
media, source origin/version, stored and displayed dimensions, orientation and existing permission text.
Choose a named page in the same project and explicitly **Use whole raster on named page**. The new
candidate has its own membership. Select or annotate it afterward; reuse does not navigate to another
page, change active selections, accept work, mount Brand context or execute a model.

## Canonical records and compatibility

`project-raster-library-item` and `project-raster-library-reuse` are immutable version-one work records
in the existing KernelStore. Save identity binds project + exact candidate version/integrity. The first
validated source membership is frozen; subsequent memberships cannot change it or duplicate the save.
Reuse identity binds exact item + target page. Repeating it returns the same candidate. Later candidate
replacement never substitutes a Library source's pinned version, permission or bytes.

Kernel gates independently enforce exact project/source/page ownership, eligible placeable candidate
media, source membership, media integrity, observed geometry/orientation, original origin and rights,
typed closure, deterministic identities and immutable roles. Arbitrary receipt/reference-only payloads
cannot become Library candidates. Reused artifacts contain only the raster descriptor and media
dependency; original design references and Library lineage live in work records. No design artifact
depends on another design artifact. Failed packet groups roll back candidate, membership and reuse.

Service decoding is asynchronous so ordinary Cancel/Revoke can run during cold media reads. The
synchronous persistence gate also fully decodes unverified bytes through a bounded offline Node/Sharp
worker (bytes on stdin, no user paths/URLs or provider), then caches observed facts by content hash.
Each cache use rechecks exact stored bytes. This is validation, not image generation. No new
dependency, SQLite schema change, migration, second database or asset deletion is introduced.

Both work-record kinds participate in V04 exact evidence and independently derived capsule completeness.
Missing ledger-known versions retain explicit unknown-scope evidence; ordinary save/reuse cannot
replace a missing historical Library identity. Recovery remains outside this operation. Save/reuse may change relevant
history; listing, inspection and downloads add no canonical events and do not continually stale capsules.
Stored historical capsules remain immutable, with explicit refresh and separate truthful currency.
Existing projects have a truthful empty Library. V01 synthetic batches retain null authorization;
production execution remains disconnected. All existing controls, drafts and exports remain supported.

## Original bytes and closed raster package

Original PNG/JPEG/WebP downloads retain bytes, content SHA256, format/MIME, length, encoded dimensions
and EXIF orientation. No rotation/transcoding occurs. Display dimensions are separately observed from
orientation; encoded-top-left remains the selection coordinate system.

The distinct `raster` ustar mode contains exactly `manifest.json` and
`assets/<content-sha256>.<png|jpg|webp>`. It uses generated paths, regular files, deterministic order,
zero timestamps and bounded payloads. The strict manifest includes exact project/optional Library/source/
membership/media identities and integrities, observed image facts/orientation, original candidate origin
and permission text. It makes no executor or actual-generation claim. Requested/inferred controls are
explicitly not included; they are never mislabelled observed. No unrelated packets, grants, credentials,
runtime paths, Brand JSON or HTML are serialized. Package import/restore is outside this slice.

Bounds: existing image maximum 8 MiB, 8192 px per edge / 16 MP, single frame; manifest 64 KiB;
one raster per package; Library inventory follows V04's 4096 primary-version bound and response pages
contain at most 50 items. Paging counts omissions and unknown primary content explicitly. Compare
stable exact references when iterating lists across writes. No conversion or rights policy is invented.

## Routes

All routes use existing local host/origin protections; writes require the visual session token.
Under `/api/v1/visual/library/`: GET `state` uses `project`, `offset`, `limit`; GET `item`, `original`,
`package` use `project`, exact `id`/`version` and `integrity`. GET `candidate-preview`, `candidate-original`,
`candidate-package` additionally require exact `unit`/`unitVersion` for the workspace context.
POST `save` takes `{projectId,input:{expectedProject,unit,candidate,integrity,extent:"whole"}}`;
POST `reuse` takes `{projectId,input:{expectedProject,unit,item,integrity}}`, where `unit` names the target.
Stale request expectations reject; reads preserve intentionally pinned historical sources.

Rollback uses an isolated prior checkout at the accepted V04 head and a complete closed matching
runtime copy. Never downgrade evolved real storage in place or selectively delete history/media.
Cross-project transfer, conversion/crop formats, final layout/count default, HTML reconstruction and
actual local recipe binding remain unresolved. Independent review owns acceptance and task completion.
