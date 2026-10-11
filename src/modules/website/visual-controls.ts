/** Requested intent vocabulary from the approved Website inventory; never measured pixel state. */
export interface RequestControl {
  key: string;
  label: string;
  level: 1 | 2;
  family: string;
  type: "scale" | "count" | "px" | "color" | "text" | "category";
  options?: string[];
  unavailable?: string;
  fields?: RequestControl[];
}
export const requestControls: RequestControl[] = [
  ...[
    ["contrast", "Contrast", "scale"],
    ["accent-color", "Accent color", "color"],
    ["font", "Font", "text"],
    ["background-color", "Background color", "color"],
    ["spacing", "Spacing", "px"],
    ["corner-rounding", "Corner rounding", "px"],
  ].map(([key, label, type]) => ({
    key: key!,
    label: label!,
    type: type as RequestControl["type"],
    level: 1 as const,
    family: "Direct requests",
  })),
  ...[
    ["visual-density", "Visual Density"],
    ["whitespace", "Whitespace"],
    ["image-dominance", "Image Dominance"],
    ["grid-rigidity", "Grid Rigidity"],
    ["asymmetry", "Asymmetry"],
  ].map(([key, label]) => ({
    key: key!,
    label: label!,
    type: "scale" as const,
    level: 2 as const,
    family: "Spatial",
  })),
  {
    key: "layout-complexity",
    label: "Layout Complexity",
    level: 2,
    family: "Structural",
    type: "scale",
  },
  {
    key: "section-count",
    label: "Section Count",
    level: 2,
    family: "Structural",
    type: "count",
  },
  {
    key: "column-structure",
    label: "Column Structure",
    level: 2,
    family: "Structural",
    type: "category",
    options: ["single", "multiple", "mixed"],
  },
  {
    key: "content-width",
    label: "Content Width",
    level: 2,
    family: "Structural",
    type: "px",
  },
  {
    key: "section-height",
    label: "Section Height",
    level: 2,
    family: "Structural",
    type: "px",
  },
  ...[
    ["color-intensity", "Color Intensity"],
    ["typography-expression", "Typography Expression"],
    ["shadow-depth", "Shadow & Depth"],
    ["accent-usage", "Accent Usage"],
  ].map(([key, label]) => ({
    key: key!,
    label: label!,
    type: "scale" as const,
    level: 2 as const,
    family: "Styling",
  })),
  {
    key: "surface-style",
    label: "Surface Style",
    level: 2,
    family: "Styling",
    type: "category",
    options: ["flat", "textured", "layered"],
  },
  {
    key: "visual-effects",
    label: "Visual Effects",
    level: 2,
    family: "Styling",
    type: "category",
    options: ["none", "subtle", "pronounced"],
    // Keep the legacy field's original strength labels valid for stored requests.
    // New authoring uses independent category and bounded strength fields.
    fields: [
      { key: "visual-effects-category", label: "Visual Effects category", level: 2, family: "Styling", type: "category", options: ["none", "blur", "glow", "grain"] },
      { key: "visual-effects-strength", label: "Visual Effects strength", level: 2, family: "Styling", type: "scale" },
    ],
  },
  ...[
    ["motion-amount", "Motion Amount"],
    ["motion-speed", "Motion Speed"],
    ["scroll-choreography", "Scroll Choreography"],
    ["interaction-feedback", "Interaction Feedback"],
    ["micro-interactions", "Micro-interactions"],
  ].map(([key, label]) => ({
    key: key!,
    label: label!,
    type: "scale" as const,
    level: 2 as const,
    family: "Dynamics",
    unavailable:
      "Requires motion or interaction; unavailable for static raster requests.",
  })),
];
export const requestFields = requestControls.flatMap((c) => c.fields ?? [c]);
