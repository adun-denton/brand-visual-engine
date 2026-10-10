/** Shared native/API output contract. Validation additionally enforces links, contrast and locks. */
const text = { type: 'string' };
const strings = { type: 'array', items: text };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const enumeration = (values: string[]) => ({ type: 'string', enum: values });
const number = (minimum: number, maximum: number) => ({
  type: 'integer',
  minimum,
  maximum,
});
const style = {
  background: text,
  foreground: text,
  accent: text,
  actionText: text,
  font: enumeration(['system', 'serif', 'rounded']),
  bodySize: number(16, 24),
  headingSize: number(32, 80),
  spacing: number(24, 120),
  radius: number(0, 32),
  maxWidth: number(960, 1280),
};
const reference = object({
  id: text,
  version: number(1, 1000000),
  freshness: enumeration(['pinned']),
});
const block = object({
  id: text,
  kind: enumeration(['heading', 'paragraph', 'list', 'button', 'image']),
  text,
  href: text,
  items: strings,
  asset: { type: 'null' },
  image: { type: 'null' },
  alt: text,
  unresolved: text,
});
// API strict objects require all keys: nullable overrides normalize to omitted keys on intake.
const overrides = object(
  Object.fromEntries(
    Object.entries(style).map(([k, v]) => [
      k,
      { anyOf: [v, { type: 'null' }] },
    ]),
  ),
);
const section = object({
  id: enumeration(['hero', 'services', 'proof', 'contact']),
  recipe: enumeration(['stack', 'split', 'cards', 'band']),
  align: enumeration(['left', 'center']),
  fit: enumeration(['cover', 'contain']),
  overrides,
  blocks: { type: 'array', items: block, maxItems: 15 },
});
const page = object({
  title: text,
  description: text,
  style: object(style),
  sections: { type: 'array', items: section, minItems: 4, maxItems: 4 },
  unresolved: strings,
});
const need = object({
  section: enumeration(['hero', 'services', 'proof', 'contact']),
  role: text,
  prompt: text,
  size: enumeration(['1024x1024', '1536x1024', '1024x1536']),
  preservation: strings,
  references: { type: 'array', items: reference, maxItems: 4 },
});
export const aiOutputSchema = object({
  schema: { type: 'string', enum: ['bve.ai-directions'] },
  version: { type: 'integer', enum: [1] },
  candidates: {
    type: 'array',
    minItems: 1,
    maxItems: 9,
    items: object({
      title: text,
      rationale: text,
      constraints: strings,
      uncertainty: text,
      unresolved: strings,
      page,
      imageNeeds: { type: 'array', items: need, minItems: 4, maxItems: 4 },
    }),
  },
});
