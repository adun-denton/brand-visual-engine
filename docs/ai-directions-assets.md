# AI directions and reusable assets

Explore in the application prepares an immutable AI direction request. It never runs the fixed
parameter sweep or substitutes fixture candidates when an executor is unavailable. Deterministic
rendering/validation/storage remain supporting mechanisms. Legacy directions remain readable;
the deterministic generator is available only through explicit test dependency injection.

## Connected operator flow

1. Save the brief and deliberate reference roles. In **02 Explore & compare**, choose 1/3/6/9
   candidates, optional prior direction and instructions. Check only references to include. **Explore
   directions** saves a pending request without accepting or generating candidates.
2. **Export AI direction request** downloads the pinned brief/context/base, chosen reference
   descriptors and complete versioned output schema. Take it to your authorized native AI and attach
   only its chosen original reference files. Request the exact JSON response contract. Import that
   response with its source/evidence reference, reported model if known and explicit AI-authorship
   attestation. This attestation is not designer/brand approval. Unknown native settings/usage stay unknown.
3. Alternatively **Prepare API directions** saves a queued attempt in **05 Images & assistant**.
   Explicit submission requires credentials, an approved bounded policy/model and separately approved
   `directionGenerationApproved: true`. The original image/assistant three-call approval does not fund
   this operation. No automatic submit/retry occurs. Returned output remains unapplied until **Apply
   API candidates as directions**. Late/cancelled/stale/uncertain output cannot apply as a current direction.
4. Inspect structured previews, rationale, uncertainty and per-section image needs. Compare/select,
   then separately accept an exact direction with a reason. Selection supplies the native/API original
   design and section-specific image prompt, preservation and API aspect defaults. These stay editable;
   changing original/section refreshes defaults. Reference hints remain visible, with deliberate inclusion.
5. In **08 Project assets**, upload a permitted raster or choose an owned native/API/regional/reference
   original. Record label, permission/provenance reason and reference/placeable role. No provider or export
   automatically receives the entire asset collection. A reference is not a final asset until a deliberate
   placeable revision. Inspect/download historical versions and original hashes/dimensions.
6. **Place exact asset in direction** chooses an exact direction/bundle, section, alt text or unresolved
   accessibility note and reason. It fills the first AI-authored image slot and creates a new direction
   revision; prior acceptance and other directions remain pinned. Place the same asset under another
   direction and compare those previews. If no image slot exists, refine through AI or edit composition.
7. **07 Compose page** starts from the chosen AI-authored copy/order/recipes/style/images. Edit/save,
   review desktop/narrow and explicitly accept the exact page. Download the existing self-contained
   accepted handoff. Only page placements' files are included. Asset metadata identifies permission,
   role and original provenance. AI image-need private reference pointers are omitted from the handoff.

Native image handoffs retain their existing selected scoped reference semantics. API generation is
text-only; editing/assistant accepts explicitly checked references. The asset panel does not turn
its reference-only assets into a second provider reference board. To send one as a reference, attach
its exact original through Brief & references and explicitly choose its role/scope/inclusion there.

## Contract and boundaries

The existing seven-field WebsiteDesignState carries a validated `parameters.ai` specification:
exact request/evidence refs, authored rationale/constraints/uncertainty, bounded CompositionContent
and one image need per section. AI response v1 declares `bve.ai-directions`, requested candidate count,
copy/styles/layout and image needs. It cannot invent an owned image placement, alter locked visible
intent/required content/palette or claim human approval. Strict parsing additionally enforces safe links,
contrast, block IDs, numeric bounds and ownership. API strict output uses null for unoverridden style
keys; native JSON can omit them. Both normalize to the same inspectable page state.

New immutable Website kinds are `website-ai-request`, `website-ai-evidence`, `website-asset`.
Bundles add `variationPlan.strategy: ai-authored`; existing fixture bytes/strategy remain unchanged.
Placed images bind owned pinned asset versions/descriptors and checksum-verified originals. Role changes
never rewrite historical permission/placement. Relational read validation binds direction decisions back
to exact AI output; placement revisions can only change the image slots. Atomic append/CAS rejects stale
requests, concurrent apply and direction/bundle/asset-role updates. Provider execution retains the existing
reservation, restart-uncertain, cancellation, late-result and reconciliation machinery.

Four section identities remain hero/services/proof/contact. Recipes are stack/split/cards/band;
fonts are system/serif/rounded; responsive layout uses the documented 760px breakpoint. Full chat-to-project
import, general section identities, new modules, publishing, real booking interactions and full asset-store
unification remain outside this change. Designer evaluation and owner/license/live/release decisions
remain pending; synthetic passing checks are not those decisions.

## Verification and rollback

Use Node 24.19.0 and the locked install/Playwright setup in [workspace](workspace.md).
`npm run test:browser:ai-assets` exercises real controls/downloads at 1440/390 and a gracefully closed
copy. Its response is explicitly authored mechanical fixture data, not actual AI/provider proof.
Separate native AI evidence must record exact request/output hashes and observed identity; a primary
implementer's output/self-assessment does not establish independent technical acceptance.

Close and back up both stores/assets before adoption. No destructive database migration is introduced,
but old software cannot interpret the additive kinds/strategy. Roll back via the unmerged dependent draft
or scoped revert to the accepted Phase A base, retaining new history and restoring a closed pre-adoption
copy with matching software when necessary. Never delete new records to simulate successful rollback.
