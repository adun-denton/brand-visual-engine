import { record, InputError } from "../../service/validation.ts";

type ValueSchema = {
  type?: "string" | "number";
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
  anyOf?: ValueSchema[];
};
interface StyleRule {
  schema: ValueSchema;
  expected: string;
  example: string | number;
  pixels: boolean;
}
const rule = (schema: ValueSchema, expected: string, example: string | number, pixels = false): StyleRule =>
  ({ schema, expected, example, pixels });
const enumerated = (values: readonly string[], example = values[0]!) =>
  rule({ type: "string", enum: values }, "one of " + values.join(", "), example);
const numeric = (minimum: number, maximum: number, example: number) =>
  rule({ type: "number", minimum, maximum }, "JSON number from " + minimum + " to " + maximum + "; not a quoted number", example);

// Preserve the old parseFloat <=4096 boundary, including IEEE-754 rounding.
// At4096 the next binary64 value is 2^-40 higher; its midpoint rounds to4096.
// Build a decimal-fraction pattern <= that exact midpoint, not a new CSS grammar.
function fractionAtMost(bound: string): string {
  if (!bound) return "0*";
  const digit = Number(bound[0]);
  const equal = bound[0] + "(?:" + fractionAtMost(bound.slice(1)) + ")?";
  return digit ? "(?:[0-" + (digit - 1) + "][0-9]*|" + equal + ")" : equal;
}
const scalar = "(?:[0-9]{1,3}|[1-3][0-9]{3}|40[0-8][0-9]|409[0-5])(?:\\.[0-9]+)?";
const ceiling = "4096(?:\\." + fractionAtMost("00000000000045474735088646411895751953125") + ")?";
const dimensionPattern = "^(?:auto|0*(?:" + scalar + "|" + ceiling + ")(?:px|rem|em|ch|%|vw|vh))$";
const dimension = (minimum = 0) => rule({
  anyOf: [
    { type: "number", minimum, maximum: 4096 },
    { type: "string", pattern: dimensionPattern },
  ],
}, "JSON number from " + minimum + " to 4096 (pixels), or auto, or one nonnegative scalar <=4096 with px/rem/em/ch/%/vw/vh; no compound shorthand", 22, true);
const text = (pattern: string, expected: string, example: string, maxLength?: number) =>
  rule({ type: "string", pattern, ...(maxLength === undefined ? {} : { maxLength }) }, expected, example);
const colorPattern = "^(#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})|transparent|currentColor)$";
const color = () => text(colorPattern, "hex color with 3/4/6/8 digits, transparent or currentColor", "#153932");

// One authority for parsing, JSON Schema, examples, guidance and numeric CSS units.
// These are the pre-existing permitted properties, enums, ranges and grammars.
export const styleRules = {
  display: enumerated(["block", "flex", "grid", "inline", "inline-block", "none"], "grid"),
  flexDirection: enumerated(["row", "column", "row-reverse", "column-reverse"]),
  flexWrap: enumerated(["wrap", "nowrap"]),
  justifyContent: enumerated(["start", "end", "center", "space-between", "space-around", "space-evenly"]),
  alignItems: enumerated(["start", "end", "center", "stretch", "baseline"]),
  gap: dimension(),
  gridTemplateColumns: text("^(?:minmax\\(0,[0-9.]+fr\\)|[0-9.]+(?:fr|px|%|rem)|auto)(?: (?:minmax\\(0,[0-9.]+fr\\)|[0-9.]+(?:fr|px|%|rem)|auto))*$", "explicit columns such as 1fr 1fr 1fr or minmax(0,1fr) auto; max200 characters; no repeat()/calc()", "1fr 1fr 1fr", 200),
  gridColumn: text("^(auto|[1-9][0-9]?(?: \\/ (?:[1-9][0-9]?|span [1-9][0-9]?))?)$", "auto or integer1–99, optionally / integer1–99 or / span integer1–99 with single spaces", "1 / span 2"),
  gridRow: text("^(auto|[1-9][0-9]?(?: \\/ (?:[1-9][0-9]?|span [1-9][0-9]?))?)$", "auto or integer1–99, optionally / integer1–99 or / span integer1–99 with single spaces", "auto"),
  padding: dimension(),
  margin: dimension(),
  width: dimension(),
  maxWidth: dimension(),
  minHeight: dimension(),
  background: color(),
  color: color(),
  fontFamily: text("^[A-Za-z0-9 ,'-]+$", "local font-family string using ASCII letters/digits, spaces, commas, apostrophes or hyphens; max150 characters", "Georgia, serif", 150),
  fontSize: dimension(),
  fontWeight: numeric(100, 900, 700),
  lineHeight: numeric(0.8, 4, 1.05),
  letterSpacing: dimension(-10),
  textAlign: enumerated(["left", "right", "center", "start", "end"]),
  border: text("^(none|[0-9]{1,2}px (?:solid|dashed|dotted) (?:#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})|currentColor))$", "none or a whole border: 0–99px solid/dashed/dotted plus hex3/4/6/8 or currentColor; no side shorthand", "1px solid #abc"),
  borderRadius: dimension(),
  objectFit: enumerated(["cover", "contain"]),
  aspectRatio: text("^[1-9][0-9]{0,2} \\/ [1-9][0-9]{0,2}$", "two integers1–999 separated by space / space", "16 / 9"),
  opacity: numeric(0, 1, 1),
};
export const styleProperties = Object.keys(styleRules) as (keyof typeof styleRules)[];
export const numericStyles = new Set<string>(styleProperties.filter(p => styleRules[p].pixels));
export const styleValueDefinitions = { styleDimension: styleRules.padding.schema.anyOf![1]! };
export const styleObjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(styleProperties.map(p => [p, {
    ...styleRules[p].schema, ...(styleRules[p].pixels ? {anyOf: [styleRules[p].schema.anyOf![0]!, {$ref: "#/$defs/styleDimension"}]} : {}), description: styleRules[p].expected, examples: [styleRules[p].example],
  }])),
};
export const styleSchema = { ...styleObjectSchema, $defs: styleValueDefinitions };
export const styleGuidance = {
  properties: Object.fromEntries(styleProperties.map(p => [p, styleRules[p].expected])),
  example: Object.fromEntries([
    "display", "padding", "margin", "fontWeight", "lineHeight", "gridTemplateColumns",
    "border", "color", "fontFamily", "aspectRatio",
  ].map(p => [p, styleRules[p as keyof typeof styleRules].example])),
};

function matches(schema: ValueSchema, value: unknown): boolean {
  if (schema.anyOf) return schema.anyOf.some(s => matches(s, value));
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value)
    && value >= schema.minimum! && value <= schema.maximum!;
  return typeof value === "string"
    && (!schema.enum || schema.enum.includes(value))
    && (schema.maxLength === undefined || value.length <= schema.maxLength)
    && (!schema.pattern || new RegExp(schema.pattern).test(value));
}
export interface StyleLocation { path: string; nodeId: string }
export class StyleError extends InputError {
  constructor(property: string, expected: string, example?: string | number, location?: StyleLocation) {
    const name = JSON.stringify(property.slice(0, 160));
    const where = location ? location.path + "[" + name + "] (node " + location.nodeId + ")" : "Style property " + name;
    super(where + ": expected " + expected + (example === undefined ? "" : "; example " + JSON.stringify(example)) + ".");
  }
}
export function parseStyle(input: unknown, location?: StyleLocation): Record<string, string | number> {
  let r: Record<string, unknown>;
  try { r = record(input, [...styleProperties]); }
  catch (error) {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const unknown = Object.keys(input).find(p => !styleProperties.includes(p as keyof typeof styleRules));
      if (unknown !== undefined) throw new StyleError(unknown, "a permitted property from outputSchema.$defs.style", undefined, location);
    }
    throw error;
  }
  for (const [p, value] of Object.entries(r)) {
    const spec = styleRules[p as keyof typeof styleRules];
    if (!matches(spec.schema, value)) throw new StyleError(p, spec.expected, spec.example, location);
  }
  return r as Record<string, string | number>;
}
