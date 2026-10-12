// Existing page grammar, shared by parser, inference schema and guidance.
// Schema is a shape gate; cross-node/request relationships still require semantic intake.
export const pageLimits = {
  identity: 160, title: 200, language: 30, text: 8000, href: 500,
  item: 2000, alt: 1000, entries: 100, nodes: 400, depth: 12,
  viewportMin: 240, viewportMax: 4096, handle: 100,
  candidates: 6, actions: 32, prose: 4000,
} as const;
export const localIdentityPattern = "^[a-zA-Z0-9_-]+$";
export const languagePattern = "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$";
export const hrefPattern = "^(#[a-zA-Z0-9_-]+|\\/(?:[a-zA-Z0-9_-]+\\/?)*|https:\\/\\/[^\\s<>\"'\\\\]+|mailto:[a-zA-Z0-9._+@-]+|tel:[+0-9()-]+)$";
export const pageKinds = ["container", "section", "heading", "text", "link", "list", "media"] as const;
export const kindFields = [
  { kinds: ["heading", "text", "link"], fields: ["text"] },
  { kinds: ["heading"], fields: ["level"] },
  { kinds: ["link"], fields: ["href"] },
  { kinds: ["list"], fields: ["items"] },
  { kinds: ["media"], fields: ["slot", "alt", "decorative"] },
  { kinds: ["container", "section"], fields: ["children"] },
] as const;
// The existing string()/id() parser trims outer ECMAScript whitespace, and bounds
// the original UTF-16 length. JSON Schema maxLength counts Unicode code points;
// that last distinction remains a semantic guard (do not tighten parser grammar).
export const pageTextSchema = (maxLength: number, empty = false) => ({
  type: "string", maxLength, ...(empty ? {} : { pattern: "\\S" }),
});
export const trimmedPattern = (pattern: string) => "^\\s*(?:" + pattern.slice(1, -1) + ")\\s*$";
export const localIdentitySchema = {
  ...pageTextSchema(pageLimits.identity), pattern: trimmedPattern(localIdentityPattern),
};
export const pageGuidance = {
  validation: "Output schema checks shape and representable values only. Semantic intake also checks same-page relationships, aggregate limits, exact request/media ownership and preservation before storing any candidate. Failure of one candidate rejects the entire submission; no automatic repair or retry.",
  identity: "Every node requires its own local id: 1–160 input UTF-16 units, ASCII letters/digits/underscore/hyphen after outer whitespace trimming; unique within this candidate page. These are local HTML element identities, not kernel/artifact/version IDs. Do not invent kernel IDs or acceptance. Each page has its own identity namespace.",
  links: "A link requires text and href. href (max500 input UTF-16 units) may be #local-id, a slash path of ASCII letters/digits/underscore/hyphen, https:// with no whitespace/angle brackets/quotes/backslash, mailto: using ASCII letters/digits/._+@-, or tel: using +digits()- . A #target must exactly match a node id in this SAME candidate page, case-sensitive after trimming; forward/backward/nested targets and repeated links to an existing target are allowed. Another candidate or page cannot supply a target. Do not drop links or synthesize targets to fix rejection.",
  // Illustrates a relationship only, not a required page layout or section vocabulary.
  linkExample: [
    { id: "local-link", kind: "link" as const, text: "View detail", href: "#local-target" },
    { id: "local-target", kind: "text" as const, text: "Detail" },
  ],
  fields: kindFields,
  bounds: pageLimits,
  relationships: [
    "Root is container or section. At most400 total nodes; root depth0, maximum depth12. Containers/sections have at most100 children each. No prescribed section order, image count, layout, branding or breakpoint.",
    "media has exactly the set of slots used by media nodes; repeated use of one slot is allowed. Every slot maps to null or an exact supplied placeable/upload handle. Reference-only, foreign, unknown or invented handles cannot be placed. Uploads are a separately authorized intake, not model-created files.",
    "Media explicitly declares decorative. When true, alt must trim to empty. Informational empty alt is accepted as an unresolved finding, not silently treated as decorative.",
    "Each responsive nodeId must exist in the same page; maxWidth is an integer240–4096. At most100 responsive entries. Repeated targets/breakpoints remain permitted. Styles use the separate property-specific styleGuidance authority.",
    "mediaRequirements target existing page slots (including currently resolved slots); at most100 entries. Proposed actions (at most32) remain unexecuted. candidates at most6; create/revise needs at least one, critique may have none. Keep the exact requestId/requestHash and all frozen preservation locks.",
    "Text bounds apply before trimming and count UTF-16 units, not Unicode code points. Preserve exact locked text/style/subtrees and current ownership. Shape success does not imply semantic success, acceptance or execution authority.",
  ],
};
