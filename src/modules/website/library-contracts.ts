import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
} from "../../kernel/contracts.ts";
import type { ImageInfo, RasterOrientation } from "../../service/assets.ts";
import { canonical, digest } from "../../kernel/packets.ts";
import {
  record,
  choice,
  string,
  integer,
  InputError,
} from "../../service/validation.ts";
import { exactRef, hash, type RasterConcept } from "./exploration-contracts.ts";
import { parseImageInfo } from "./workspace-contracts.ts";

export const libraryRoles = {
  "project-raster-library-item": "work-record",
  "project-raster-library-reuse": "work-record",
} as const;
export type LibraryKind = keyof typeof libraryRoles;
export interface LibraryItem {
  version: 1;
  workUnit: VersionRef;
  candidate: VersionRef;
  candidateIntegrity: string;
  membership: VersionRef;
  membershipIntegrity: string;
  media: VersionRef;
  mediaIntegrity: string;
  image: ImageInfo;
  orientation: RasterOrientation;
  origin: RasterConcept["origin"];
  rights: string;
}
export interface LibraryReuse {
  version: 1;
  workUnit: VersionRef;
  item: VersionRef;
  itemIntegrity: string;
  candidate: VersionRef;
  candidateIntegrity: string;
  membership: VersionRef;
  membershipIntegrity: string;
}
export const libraryItemId = (
  pid: string,
  candidate: VersionRef,
  integrity: string,
) => "raster-library-" + digest({ projectId: pid, candidate, integrity });
export const libraryReuseKey = (
  pid: string,
  item: VersionRef,
  unit: VersionRef,
) => digest({ projectId: pid, item, workUnit: unit });
export function parseOrientation(x: unknown): RasterOrientation {
  const r = record(x, ["coordinates", "exif", "displayWidth", "displayHeight"]);
  return {
    coordinates: choice(r["coordinates"], ["encoded-top-left"]),
    exif: r["exif"] === null ? null : integer(r["exif"], 8),
    displayWidth: integer(r["displayWidth"], 8192),
    displayHeight: integer(r["displayHeight"], 8192),
  };
}
export function parseLibraryItem(x: unknown): LibraryItem {
  const r = record(x, [
    "version",
    "workUnit",
    "candidate",
    "candidateIntegrity",
    "membership",
    "membershipIntegrity",
    "media",
    "mediaIntegrity",
    "image",
    "orientation",
    "origin",
    "rights",
  ]);
  if (r["version"] !== 1) throw new InputError("Library schema version");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    candidate: exactRef(r["candidate"]),
    candidateIntegrity: hash(r["candidateIntegrity"]),
    membership: exactRef(r["membership"]),
    membershipIntegrity: hash(r["membershipIntegrity"]),
    media: exactRef(r["media"]),
    mediaIntegrity: hash(r["mediaIntegrity"]),
    image: parseImageInfo(r["image"]),
    orientation: parseOrientation(r["orientation"]),
    origin: choice(r["origin"], [
      "imported",
      "synthetic",
      "generated",
      "semantic-screenshot",
    ]),
    rights: string(r["rights"]),
  };
}
export function parseLibraryReuse(x: unknown): LibraryReuse {
  const r = record(x, [
    "version",
    "workUnit",
    "item",
    "itemIntegrity",
    "candidate",
    "candidateIntegrity",
    "membership",
    "membershipIntegrity",
  ]);
  if (r["version"] !== 1) throw new InputError("Library schema version");
  return {
    version: 1,
    workUnit: exactRef(r["workUnit"]),
    item: exactRef(r["item"]),
    itemIntegrity: hash(r["itemIntegrity"]),
    candidate: exactRef(r["candidate"]),
    candidateIntegrity: hash(r["candidateIntegrity"]),
    membership: exactRef(r["membership"]),
    membershipIntegrity: hash(r["membershipIntegrity"]),
  };
}
export function validateLibraryRecord(x: Record<string, unknown>): boolean {
  if (!Object.hasOwn(libraryRoles, String(x["kind"]))) return false;
  record(x, ["moduleId", "kind", "scope", "lockedValues", "state"]);
  if (
    x["moduleId"] !== "website" ||
    x["scope"] !== "project-raster-library" ||
    Object.keys(record(x["lockedValues"], [])).length
  )
    throw new InputError("Library record ownership");
  const state =
    x["kind"] === "project-raster-library-item"
      ? parseLibraryItem(x["state"])
      : parseLibraryReuse(x["state"]);
  if (canonical(state) !== canonical(x["state"]))
    throw new InputError("Noncanonical Library state");
  return true;
}
export interface RasterManifest {
  version: 1;
  kind: "bve-raster-package";
  authority: "raster-reference-only";
  projectId: string;
  library: { ref: VersionRef; integrity: string } | null;
  source: {
    candidate: VersionRef;
    integrity: string;
    workUnit: VersionRef;
    membership: VersionRef;
    membershipIntegrity: string;
    media: VersionRef;
    mediaIntegrity: string;
  };
  raster: {
    path: string;
    mime: string;
    extension: "png" | "jpg" | "webp";
    image: ImageInfo;
    orientation: RasterOrientation;
  };
  provenance: {
    origin: RasterConcept["origin"];
    rights: string;
    generationClaim: "not-established";
    executor: null;
    requestedControls: "not-included";
    inferredControls: "not-included";
  };
}
export const rasterExtension = (i: ImageInfo) =>
  i.format === "jpeg" ? "jpg" : i.format;
export const rasterMime = (i: ImageInfo) => "image/" + i.format;
export function parseRasterManifest(x: unknown): RasterManifest {
  const r = record(x, [
    "version",
    "kind",
    "authority",
    "projectId",
    "library",
    "source",
    "raster",
    "provenance",
  ]);
  if (r["version"] !== 1) throw new InputError("Raster manifest version");
  const s = record(r["source"], [
    "candidate",
    "integrity",
    "workUnit",
    "membership",
    "membershipIntegrity",
    "media",
    "mediaIntegrity",
  ]);
  const a = record(r["raster"], [
      "path",
      "mime",
      "extension",
      "image",
      "orientation",
    ]),
    image = parseImageInfo(a["image"]),
    orientation = parseOrientation(a["orientation"]);
  const path = "assets/" + image.checksum + "." + rasterExtension(image);
  if (
    a["path"] !== path ||
    a["mime"] !== rasterMime(image) ||
    a["extension"] !== rasterExtension(image) ||
    orientation.displayWidth !==
      ([5, 6, 7, 8].includes(orientation.exif ?? 0)
        ? image.height
        : image.width) ||
    orientation.displayHeight !==
      ([5, 6, 7, 8].includes(orientation.exif ?? 0)
        ? image.width
        : image.height)
  )
    throw new InputError("Raster manifest facts/path mismatch");
  const p = record(r["provenance"], [
    "origin",
    "rights",
    "generationClaim",
    "executor",
    "requestedControls",
    "inferredControls",
  ]);
  if (p["executor"] !== null)
    throw new InputError("No executor claim in raster export");
  const l =
    r["library"] === null ? null : record(r["library"], ["ref", "integrity"]);
  return {
    version: 1,
    kind: choice(r["kind"], ["bve-raster-package"]),
    authority: choice(r["authority"], ["raster-reference-only"]),
    projectId: string(r["projectId"], 160),
    library: l
      ? { ref: exactRef(l["ref"]), integrity: hash(l["integrity"]) }
      : null,
    source: {
      candidate: exactRef(s["candidate"]),
      integrity: hash(s["integrity"]),
      workUnit: exactRef(s["workUnit"]),
      membership: exactRef(s["membership"]),
      membershipIntegrity: hash(s["membershipIntegrity"]),
      media: exactRef(s["media"]),
      mediaIntegrity: hash(s["mediaIntegrity"]),
    },
    raster: {
      path,
      mime: rasterMime(image),
      extension: rasterExtension(image),
      image,
      orientation,
    },
    provenance: {
      origin: choice(p["origin"], [
        "imported",
        "synthetic",
        "generated",
        "semantic-screenshot",
      ]),
      rights: string(p["rights"]),
      generationClaim: choice(p["generationClaim"], ["not-established"]),
      executor: null,
      requestedControls: choice(p["requestedControls"], ["not-included"]),
      inferredControls: choice(p["inferredControls"], ["not-included"]),
    },
  };
}
export type LibraryPacket<T = LibraryItem> = NodePacket<DesignArtifact<T>>;
