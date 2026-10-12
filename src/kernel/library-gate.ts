import type { GateEnvironment } from "./gate.ts";
import { revalidatePacket, writePort } from "./gate.ts";
import type { NodePacket, DesignArtifact, VersionRef } from "./contracts.ts";
import { canonical, reference } from "./packets.ts";
import {
  libraryRoles,
  parseLibraryItem,
  parseLibraryReuse,
  libraryItemId,
  libraryReuseKey,
  type LibraryItem,
} from "../modules/website/library-contracts.ts";
import {
  parseConcept,
  parseMembership,
  type RasterConcept,
} from "../modules/website/exploration-contracts.ts";
import type { MediaState } from "../modules/website/page.ts";
const eq = (a: unknown, b: unknown, message: string) => {
  if (canonical(a) !== canonical(b)) throw new Error(message);
};
function own<T>(
  env: GateEnvironment,
  pid: string,
  r: VersionRef,
  type: string,
  kind: string,
): NodePacket<DesignArtifact<T>> {
  const p = env.lookup(r) as NodePacket<DesignArtifact<T>> | null;
  if (
    r.freshness !== "pinned" ||
    !p ||
    p.projectId !== pid ||
    p.type !== type ||
    p.payload.kind !== kind
  )
    throw new Error("Library exact reference ownership/type mismatch");
  revalidatePacket(p, writePort(p.type), env);
  return p;
}
/** Derive facts from exact eligible candidates, never from submitted provenance. */
export function librarySource(
  env: GateEnvironment,
  pid: string,
  candidate: VersionRef,
  integrity: string,
  membership: VersionRef,
): LibraryItem {
  const c = own<RasterConcept>(
      env,
      pid,
      candidate,
      "design-artifact",
      "raster-concept",
    ),
    s = parseConcept(c.payload.state);
  if (c.integrity !== integrity)
    throw new Error("Library candidate integrity mismatch");
  const m = own<MediaState>(env, pid, s.media, "media-asset", "page-media");
  if (m.payload.state.role !== "placeable")
    throw new Error("Library requires eligible placeable candidate media");
  const member = own(env, pid, membership, "work-record", "raster-membership"),
    b = parseMembership(member.payload.state);
  eq(b.candidate, candidate, "Library source page membership mismatch");
  if (b.integrity !== c.integrity)
    throw new Error("Library source membership integrity mismatch");
  own(env, pid, b.workUnit, "work-record", "page-work-unit");
  const facts = env.rasterFacts?.(s.image);
  if (!facts)
    throw new Error(
      "Library raster must fully decode with exact integrity/dimensions",
    );
  return {
    version: 1,
    workUnit: b.workUnit,
    candidate,
    candidateIntegrity: c.integrity,
    membership,
    membershipIntegrity: member.integrity,
    media: s.media,
    mediaIntegrity: m.integrity,
    image: s.image,
    orientation: facts.orientation,
    origin: s.origin,
    rights: m.payload.state.permission,
  };
}
export function libraryGate(
  p: NodePacket<unknown>,
  previous: NodePacket<unknown> | null,
  env: GateEnvironment,
): void {
  const a = p.payload as DesignArtifact<unknown>,
    kind = a.kind,
    old = (previous?.payload as DesignArtifact<unknown> | undefined)?.kind;
  if (
    previous &&
    (Object.hasOwn(libraryRoles, kind) ||
      Object.hasOwn(libraryRoles, old ?? ""))
  )
    throw new Error("Library records/kinds are immutable");
  if (!Object.hasOwn(libraryRoles, kind)) return;
  if (
    !p.projectId ||
    p.type !== "work-record" ||
    p.approval !== "proposal" ||
    p.contextRefs.length ||
    p.constraints.length ||
    p.placeholders.length
  )
    throw new Error("Library envelope/role mismatch");
  if (
    !env.lookup(reference(p)) &&
    env
      .projectEvents?.(p.projectId)
      .some((e) => e.kind === "revision" && e.subject.id === p.id)
  )
    throw new Error(
      "Ledger-known missing Library identity cannot be replaced; recovery is outside this operation",
    );
  let deps: VersionRef[],
    assets: { id: string; checksum: string }[] = [];
  if (kind === "project-raster-library-item") {
    const s = parseLibraryItem(a.state),
      actual = librarySource(
        env,
        p.projectId,
        s.candidate,
        s.candidateIntegrity,
        s.membership,
      );
    eq(s, actual, "Library source/provenance/rights/orientation mismatch");
    if (p.id !== libraryItemId(p.projectId, s.candidate, s.candidateIntegrity))
      throw new Error("Library save identity mismatch");
    deps = [s.workUnit, s.candidate, s.membership, s.media];
    assets = [{ id: s.image.id, checksum: s.image.checksum }];
  } else {
    const s = parseLibraryReuse(a.state),
      item = own<LibraryItem>(
        env,
        p.projectId,
        s.item,
        "work-record",
        "project-raster-library-item",
      );
    if (item.integrity !== s.itemIntegrity)
      throw new Error("Library item integrity mismatch");
    own(env, p.projectId, s.workUnit, "work-record", "page-work-unit");
    const c = own<RasterConcept>(
        env,
        p.projectId,
        s.candidate,
        "design-artifact",
        "raster-concept",
      ),
      m = own(
        env,
        p.projectId,
        s.membership,
        "work-record",
        "raster-membership",
      ),
      key = libraryReuseKey(p.projectId, s.item, s.workUnit);
    if (
      p.id !== "raster-library-reuse-" + key ||
      c.id !== "library-candidate-" + key ||
      m.id !== "library-membership-" + key ||
      c.version !== 1 ||
      m.version !== 1 ||
      c.integrity !== s.candidateIntegrity ||
      m.integrity !== s.membershipIntegrity
    )
      throw new Error("Library reuse identity/integrity mismatch");
    const b = item.payload.state;
    eq(
      c.payload.state,
      {
        version: 1,
        representation: "raster-v1",
        media: b.media,
        image: b.image,
        orientation: "encoded-top-left",
        origin: b.origin,
      },
      "Reuse must retain exact media/origin",
    );
    eq(
      m.payload.state,
      {
        version: 1,
        workUnit: s.workUnit,
        candidate: reference(c),
        integrity: c.integrity,
        derivation: [b.candidate],
      },
      "Library reuse page/lineage mismatch",
    );
    deps = [s.item, s.workUnit, s.candidate, s.membership];
  }
  eq(p.dependencies, deps, "Library exact dependency closure mismatch");
  eq(p.assets, assets, "Library asset inventory mismatch");
}
