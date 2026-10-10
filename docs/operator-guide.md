# Design a landing page locally

This experimental workspace supports one local operator, four editable landing-page sections and
a developer handoff. It does not host or publish a website. Start with permitted synthetic inputs;
designer usefulness, live API verification and the owner's release/license decisions are separate.

## Install, start and keep data private

Install Node **24.19.0** and use a checkout at the candidate commit supplied by the coordinator.
In its directory run these commands on Windows PowerShell or Linux:

```sh
node --version
npm ci --ignore-scripts
npm run build
```

Choose a private folder **outside the checkout** for all workspace data. On Windows PowerShell:

```powershell
$env:BVE_RUNTIME_ROOT = Join-Path $env:LOCALAPPDATA 'BVE\my-design'
$env:BVE_PORT = '4173'
node scripts/dev.ts
```

On Linux:

```sh
export BVE_RUNTIME_ROOT="$HOME/.local/share/bve/my-design"
export BVE_PORT=4173
node scripts/dev.ts
```

Open the printed address, normally `http://127.0.0.1:4173`, in a browser on the same computer.
Keep the terminal open. Stop with **Ctrl+C** and wait for the process to exit before restarting or
copying data. Restart with the same root and code to recover saved work. `npm run dev` also builds
once and starts the server; there is no hot reload. Rebuild/restart after source changes. If the
port is busy, choose another port and use its printed address. A missing Node version, failed install,
bad root or missing build should be corrected before creating work; do not delete an existing root.

Ordinary editing requires no credential. For an offline rehearsal, use a fresh root and leave
`OPENAI_API_KEY` and `BVE_PROVIDER_POLICY_FILE` unset in that server's environment. The rehearsal
command below injects no chargeable provider. A ChatGPT subscription is not an API credential.

## Open a workspace and write the brief

1. On **Open Website**, enter **Workspace name** and choose **Freeroam** or **Branded**, then
   **Enter Website**. Open saved work using its name in the sidebar.
2. Freeroam lets brand choices remain unresolved. Branded explicitly approves the entered manual
   palette/system typography or uses a selected saved VisualOS. Only approve values you intend to
   own; missing motion and other inputs stay visible. Freeroam can later use **Explicitly switch to
   Branded** when a saved context is available.
3. In **01 Brief & references**, enter design intent, audience, offer, intended response, required
   content, exclusions, commitments and unresolved choices. Give a reason and **Save brief revision**.
   Keep real claims separate from hypotheses; blanks do not acquire invented approval.
4. **Attach reference** accepts permitted PNG/JPEG/WebP images. Give a label, role and section scope.
   **Include in requests** and **Save reference revision** control subsequent use. **Download reference
   image** returns the original bytes. Adding/changing the brief or reference invalidates old current
   exploration; earlier accepted work stays in history. Create a fresh round for the new brief.

## Compare, reject, select and accept a direction

In **02 Explore & compare**, choose 1/3/6/9 candidates and **Explore directions** to save a pinned
AI request. Export it to an authorized AI and import its validated structured response with source and
AI-authorship attestation, or prepare the separately approved API direction path. Requests remain pending
without AI output; there is no preset fallback. Follow [AI directions and assets](ai-directions-assets.md)
for the full handoff and exact JSON contract. Existing synthetic rounds are historical fixtures.

Check **Compare** on up to two proposals and **Save comparison** with reasons. To deliberately reject
one, name it and explain why in that reason, then choose the other with **Select direction**. There is
no separate Reject status; the reason preserves the alternative without erasing it.

Selection is provisional. **Accept selected design** separately records that exact version and your
reason. Changing a selection or saving a comparison does not accept it. Use **Exploration round**
and **04 History** to inspect prior decisions; a historical brief requires a new current round.

Reusable supplied/generated assets and exact cross-direction placement are in **08 Project assets**;
see [the connected asset loop](ai-directions-assets.md#connected-operator-flow).

## Bring back a native image, or use the separate API path

The selected AI direction supplies editable section image needs/defaults; inspect them before saving.
In **03 Native handoff**, choose **Original design or image**, **Section scope**, instructions and what
to preserve. **Create native request**, then **Export request JSON**. Attach the selected original
reference/input files separately when taking this ordinary section request to an authorized native
host. The application does not call the host automatically. Return its image to the **same request**
with **Import as candidate**. Inspect/download its original, then **Accept section image** with a reason.
Unknown native model/settings/usage stay unknown; importing or comparing is not acceptance.

For a section replacement, keep its first accepted image, create a new request for that same scope,
import a different image, compare the two in **05 Images & assistant** and separately accept the chosen
image. Other sections stay accepted. A composed page has its own pinned image choices: replacing an
accepted section image does not silently change a previously accepted page. Place the new exact image
in the page explicitly and save/review/accept a new revision when wanted.

**05 Images & assistant** is a separate server-side API route. **Save immutable request** prepares
inputs; submission is another explicit action. An unconfigured credential or absent approved run policy
leaves submission unavailable. Credentials belong only in private server configuration. Account/model
availability, usage and billing require actual provider evidence. Follow [provider setup and uncertainty
handling](openai-providers.md) for separately authorized live work; preserve existing approvals and remaining
call bounds instead of resetting a run. There are no automatic retries. Do not submit during Phase A.

## Refine a region and protect the rest

1. In **06 Regional edit**, choose the exact **Source image**. Draw a circle/ellipse or rectangle on
   the overlay, or enter **x/y/width/height**. Arrow keys move the selection. **Save bound selection**
   records source-pixel coordinates. A new source/crop/orientation needs a new selection.
2. Choose preset, execution path, instructions, scoped references and preservation policy, then
   **Save regional request**. Native is manual; configured API is separate. Extend-canvas/final-detail,
   native hidden settings and API mask/seed/CFG controls are unavailable in this recipe.
3. For native, **Export source / mask / references bundle** includes original files and mask guidance.
   Import the returned file with **Import regional raw candidate**, then **Retain result in regional
   comparison**. For rehearsal this file is explicitly authored synthetic output, not a host call.
4. **Create strict local composite** produces another candidate with unchanged decoded pixels outside
   the bound mask. The raw image may change outside it. Strict composition uses a hard edge; inspect
   seams and the full image alongside the matched crop. Changed dimensions block strict composition;
   there is no automatic alignment/resizing. Keep the raw result and return for a compatible input.
5. Save the compared alternatives, selection and reason using **Save regional comparison / selection**. Explicitly
   **Accept this exact regional candidate** after review. Comparison selection, acceptance and raw/composite versions
   remain separate. See [regional limits](regions.md), including the 4-million-pixel bound.

## Compose, review and export the page

In **07 Compose page**, choose **Design direction** and **Start composition**. Edit title, description,
text, links, blocks/order and section recipes. Global style applies unless **Section overrides (blank
inherits global)** sets a local value. Select **Deliberate exact image** and add alt text or an explicit
unresolved accessibility note. **Save immutable draft** refreshes the saved preview; it does not accept.

Use **Show narrow / Show desktop** and inspect the same saved page at 390/1440px: order, clipping,
contrast, headings, links and keyboard focus. Global edits mark sections whose effective values changed;
overridden values remain local. Metadata/order/context changes require all sections to be reviewed.
Recheck global header/navigation/footer as well. Geometry changes do not carry a regional mask to a
different image. Locked brief text, required content and palette cannot be removed silently.

**Record section review** with explicit exceptions. **Save comparison** preserves exact revisions.
**Accept exact composition** separately accepts the whole saved revision and unresolved exceptions.
Conflicts ask you to reopen the latest work and review again; do not overwrite another saved choice.
**Download accepted handoff** exports an archive of that accepted revision. It is not a full backup.
**Open exact revision / Open accepted revision** lets you inspect previous work.

Give the developer the complete archive: manifest, original assets, preview and RECONSTRUCT.md. They
verify hashes, reconstruct editable text/layout from manifest/instructions/assets, and compare with
the preview at both widths. Unresolved choices and technical acceptance remain explicit; this does
not approve a real brand, booking service, designer evaluation or production publication.

## Recovery and a full closed-root backup

- After an invalid import, read the visible error, correct the file and reselect it in its original
  request. Do not create a replacement job merely to conceal an error or uncertain usage.
- If a save conflicts, reopen the owning workspace/latest revision and inspect history before editing.
  Save visible edits before navigating; drafts and accepted work are different.
- After an interrupted or unknown API outcome, **stop submitting**. **Refresh provider outcomes** is
  read-only. Preserve the root, original attempt and reservation; reconcile with evidence as described
  in the provider guide. Local cancel does not prove remote cancellation or no charge.
- For a backup, stop every server using the root and wait for close. Copy the **entire folder** to a
  new private location: databases, any WAL/SHM, native/legacy assets, quarantine and private exports.
  Record the exact code commit plus file hashes. Keep the original untouched. Never copy just a database.

Windows PowerShell, after the server has exited:

```powershell
$backup = Join-Path $env:LOCALAPPDATA 'BVE\my-design-backup'
if (Test-Path $backup) { throw 'Choose a new backup folder' }
Copy-Item -LiteralPath $env:BVE_RUNTIME_ROOT -Destination $backup -Recurse
$env:BVE_RUNTIME_ROOT = $backup
node scripts/dev.ts
```

Linux, after the server has exited:

```sh
backup="$HOME/.local/share/bve/my-design-backup"
if [ -e "$backup" ]; then
  echo "Choose a new backup folder"
else
  cp -a "$BVE_RUNTIME_ROOT" "$backup" &&
    export BVE_RUNTIME_ROOT="$backup" && node scripts/dev.ts
fi
```

Restore into a new folder using matching code. Reopen actual brief/reference, comparison, region and
accepted page controls; download originals/export and compare hashes. Stop if files are missing/corrupt.
Do not test on the only copy or open additive records in incompatible old code. Online backups,
hard-power-loss behavior and Windows directory crash durability are not established by a closed copy.

## Rehearse without a designer or live provider

Developers/reviewers can run the retained checks and the guide rehearsal using the documented
[Playwright setup](workspace.md#dependencies-and-evidence):

```sh
npx playwright install chromium
npm run test:browser:readiness
```

The rehearsal creates a fresh synthetic root and visibly labels AI technical assessment. It uses
authored images/manual fixture imports, not native host calls or API submissions; it does not fill
human judgments. Set `BVE_EVIDENCE_DIR` outside Git to retain its receipt and screenshots. Consult
[candidate readiness](candidate-readiness.md) and the blank [designer trial](designer-trial-template.md).
