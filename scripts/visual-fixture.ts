/** Hand-authored synthetic compositions rasterized for interaction tests only. No model output. */
import sharp from "sharp";
export const offlineVisualProviders = {
  apiKey: null,
  imageModel: "disabled-review",
  assistantModel: "disabled-review",
  policy: null,
  timeoutMs: 1000,
};
import type { Workspace } from "../src/service/workspace.ts";
import { VisualWorkspace } from "../src/service/visual-workspace.ts";
import { packet, reference } from "../src/kernel/packets.ts";
import type { Specification } from "../src/modules/website/exploration-contracts.ts";
export async function visualFixture(
  index: number,
  format: "png" | "jpeg" | "webp" = "png",
) {
  const palettes = [
    ["#edf0e5", "#244b38", "#b6c2a0"],
    ["#f6e8da", "#713f2b", "#d2a678"],
    ["#161f2b", "#ebecdf", "#45576b"],
    ["#faf1e2", "#a64632", "#dec8a6"],
    ["#e7edf4", "#284766", "#89a6bf"],
    ["#eee5ef", "#633959", "#bda6b9"],
  ];
  const [bg, ink, accent] = palettes[index % 6]!;
  const x = index % 2 ? 330 : 45,
    hero = index % 3 === 0 ? 350 : 270;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100"><rect width="800" height="1100" fill="${bg}"/><text x="40" y="52" fill="${ink}" font-family="sans-serif" font-weight="bold" font-size="22">FORM / FIELD</text><text x="480" y="50" fill="${ink}" font-family="sans-serif" font-size="13">Studio     Work     About     Contact</text><rect x="${x}" y="115" width="410" height="${hero}" rx="${index * 7}" fill="${accent}"/><circle cx="${x + 200}" cy="250" r="100" fill="${ink}" opacity=".22"/><path d="M${x + 25} 370 Q${x + 185} 130 ${x + 385} 390" fill="none" stroke="${ink}" stroke-width="35" opacity=".35"/><text x="${index % 2 ? 45 : 490}" y="155" fill="${ink}" font-family="sans-serif" font-size="13">SPACES TO LIVE IN</text><text x="${index % 2 ? 45 : 490}" y="205" fill="${ink}" font-family="serif" font-size="38">Everyday,</text><text x="${index % 2 ? 45 : 490}" y="252" fill="${ink}" font-family="serif" font-size="38">reimagined.</text><text x="${index % 2 ? 45 : 490}" y="300" fill="${ink}" font-family="sans-serif" font-size="13">Thoughtful forms. Lasting details.</text><rect x="${index % 2 ? 45 : 490}" y="335" width="180" height="40" rx="${index * 3}" fill="${ink}"/><text x="${index % 2 ? 60 : 505}" y="360" fill="${bg}" font-family="sans-serif" font-size="12">Explore our approach →</text><text x="45" y="${hero + 190}" fill="${ink}" font-family="serif" font-size="34">Designed around you.</text>${[0, 1, 2].map((n) => `<rect x="${45 + n * 242}" y="${hero + 230}" width="220" height="190" rx="${index * 5}" fill="${accent}"/><circle cx="${155 + n * 242}" cy="${hero + 320}" r="${45 + n * 10}" fill="${ink}" opacity=".18"/><text x="${45 + n * 242}" y="${hero + 455}" fill="${ink}" font-family="sans-serif" font-size="14">${["Quiet moments", "Useful beauty", "Built to last"][n]}</text>`).join("")}<rect x="45" y="${hero + 505}" width="710" height="130" rx="10" fill="${ink}"/><text x="70" y="${hero + 555}" fill="${bg}" font-family="serif" font-size="30">Make room for a new perspective.</text><text x="70" y="${hero + 593}" fill="${bg}" font-family="sans-serif" font-size="13">Start a conversation with our studio.</text><text x="45" y="1060" fill="${ink}" font-family="sans-serif" font-size="12">HAND-AUTHORED INTERACTION FIXTURE ${index + 1} · NOT GENERATED</text></svg>`;
  return sharp(Buffer.from(svg)).toFormat(format).toBuffer();
}
export async function seedVisual(w: Workspace) {
  const v = new VisualWorkspace(w);
  const p = v.create({ title: "Form / Field · synthetic review" });
  const unit = v.exploration.createWorkUnit(p.project.id, {
    version: 1,
    pageType: "homepage",
    label: "Homepage",
    source: "Synthetic interaction harness",
  });
  const q: Specification = {
    version: 1,
    compiler: "raster-input-v1",
    project: p.project,
    workUnit: reference(unit),
    medium: "website-raster",
    operation: "create",
    selections: null,
    selectionSnapshot: null,
    rawIntent: "Synthetic partial-outcome interaction fixture",
    count: 3,
    resources: [],
    direction: "fresh",
    brand: { enabled: false },
    sourceScopes: [],
    facts: [],
    constraints: [],
    metricRequests: [],
    provenance: "Test-only harness; no image generation",
    executionAuthorization: null,
  };
  const spec = v.exploration.freeze(p.project.id, q);
  let batch = v.exploration.prepareBatch(p.project.id, reference(spec));
  for (const slot of [1, 2, 3]) {
    await v.exploration.registerSynthetic(
      p.project.id,
      {
        batch: reference(batch),
        specHash: batch.payload.state.specHash,
        slot,
        receiptId: "fixture-result-" + slot,
        outcome: "succeeded",
        message: "Hand-authored fixture intake",
        derivation: [],
      },
      slot === 2
        ? Buffer.from("invalid image fixture")
        : await visualFixture(slot === 1 ? 0 : 1),
    );
    batch = v.exploration.read(
      p.project.id,
      {
        id: batch.id,
        version: w.kernel.currentVersion(batch.id)!,
        freshness: "pinned",
      },
      "raster-batch",
    );
  }
  for (let i = 2; i < 6; i++)
    await v.exploration.importCandidate(
      p.project.id,
      reference(unit),
      await visualFixture(i),
      "Synthetic hand-authored fixture; testing only",
      "synthetic",
    );
  const cancelled = v.exploration.prepareBatch(p.project.id, reference(spec));
  const running = v.exploration.markRunning(
    p.project.id,
    reference(cancelled),
    1,
  );
  v.exploration.cancel(p.project.id, reference(running));
  const brand = packet({
    type: "visual-os",
    id: "visual-review-brand",
    approval: "accepted",
    payload: {
      values: {
        accent: { value: "#244b38", approved: true },
        unapproved: { value: "excluded", approved: false },
      },
      placeholders: {},
    },
  });
  w.kernel.put(brand);
  return { v, p, unit, brand };
}
