import type {
  VersionRef,
  ResolvedContext,
  Value,
} from '../../kernel/contracts.ts';
import type { WebsiteDesignState } from './design.ts';
import type { ImageInfo } from '../../service/assets.ts';
export const sectionIds = ['hero', 'services', 'proof', 'contact'] as const;
export type SectionId = (typeof sectionIds)[number];
export interface PageStyle {
  background: string;
  foreground: string;
  accent: string;
  actionText: string;
  font: 'system' | 'serif' | 'rounded';
  bodySize: number;
  headingSize: number;
  spacing: number;
  radius: number;
  maxWidth: number;
}
export interface PageBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'button' | 'image' | 'list';
  text: string;
  href: string;
  items: string[];
  asset: VersionRef | null;
  image: ImageInfo | null;
  alt: string;
  unresolved: string;
}
export interface PageSection {
  id: SectionId;
  recipe: 'stack' | 'split' | 'cards' | 'band';
  align: 'left' | 'center';
  fit: 'cover' | 'contain';
  overrides: Partial<PageStyle>;
  blocks: PageBlock[];
}
export interface CompositionContent {
  title: string;
  description: string;
  style: PageStyle;
  sections: PageSection[];
  unresolved: string[];
}
export interface CompositionState {
  contractVersion: 1;
  project: VersionRef;
  direction: VersionRef;
  directionState: WebsiteDesignState;
  lockedValues: Record<string, Value>;
  context: ResolvedContext;
  content: CompositionContent;
  reviews: Partial<Record<SectionId, { signature: string; reason: string }>>;
}
export interface CompositionComparison {
  compared: VersionRef[];
  selected: VersionRef | null;
  reason: string;
}
export const effectiveStyle = (
  s: PageStyle,
  section: PageSection,
): PageStyle => ({ ...s, ...section.overrides });
export const escapeHtml = (v: unknown): string =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export const imagePath = (i: ImageInfo): string =>
  `assets/${i.checksum}.${i.format === 'jpeg' ? 'jpg' : i.format}`;
const fonts = {
  system: 'system-ui,sans-serif',
  serif: 'Georgia,serif',
  rounded: 'Trebuchet MS,sans-serif',
};
/** Pure renderer shared by the live preview and standalone handoff. No input HTML, CSS or scripts. */
export function renderComposition(
  state: CompositionState,
  imageUrl: (b: PageBlock) => string,
): string {
  const c = state.content,
    e = escapeHtml,
    g = c.style;
  const css = `*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:${g.background};color:${g.foreground};font-family:${fonts[g.font]};font-size:${g.bodySize}px;line-height:1.6;overflow-wrap:anywhere}a{color:inherit}a:focus-visible{outline:3px solid currentColor;outline-offset:5px}.skip{position:absolute;left:16px;top:-100px}.skip:focus{top:8px;z-index:10;background:${g.background};padding:12px}header{max-width:${g.maxWidth}px;margin:auto;padding:24px;display:flex;gap:24px;justify-content:space-between;align-items:center}nav{display:flex;gap:20px;flex-wrap:wrap}section{padding:var(--space) 24px;background:var(--bg);color:var(--fg);font-family:var(--font);font-size:var(--body)}.inner{max-width:var(--width);margin:auto;text-align:var(--align)}h1,h2{line-height:1.12;letter-spacing:-.035em;font-size:var(--heading);margin:0 0 24px}h2{font-size:calc(var(--heading)*.65)}p{max-width:65ch;margin:0 0 24px}.center p{margin-left:auto;margin-right:auto}.blocks{display:grid;gap:24px;align-items:center}.split .blocks{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}.split .image{grid-column:2;grid-row:1 / span 5}.cards ul{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:0;list-style:none}.cards li{border:1px solid currentColor;border-radius:var(--radius);padding:24px}.button{display:inline-block;width:fit-content;padding:12px 24px;background:var(--accent);color:var(--action);border-radius:var(--radius);text-decoration:none;font-weight:700}.center .button{margin:auto}img{display:block;width:100%;height:auto;max-height:480px;object-fit:var(--fit);border-radius:var(--radius)}.missing{border:2px dashed currentColor;padding:24px}.band{border-top:1px solid currentColor}footer{padding:24px;text-align:center}small{font-size:14px}@media(max-width:760px){header{align-items:flex-start;flex-direction:column;gap:12px}nav{gap:14px}section{padding:calc(var(--space)*.65) 20px}h1{font-size:clamp(32px,9vw,var(--heading))}h2{font-size:clamp(26px,7vw,calc(var(--heading)*.65))}.split .blocks{grid-template-columns:minmax(0,1fr)}.split .image{grid-column:auto;grid-row:auto}.cards ul{grid-template-columns:minmax(0,1fr)}img{max-height:360px}}`;
  const sections = c.sections
    .map((s) => {
      const st = effectiveStyle(g, s);
      const style = `--bg:${st.background};--fg:${st.foreground};--accent:${st.accent};--action:${st.actionText};--space:${st.spacing}px;--radius:${st.radius}px;--width:${st.maxWidth}px;--body:${st.bodySize}px;--heading:${st.headingSize}px;--font:${fonts[st.font]};--align:${s.align};--fit:${s.fit}`;
      return `<section id="${s.id}" class="${s.recipe} ${s.align}" style="${e(style)}"><div class="inner"><div class="blocks">${s.blocks.map((b) => (b.kind === 'heading' ? `<h${s.id === 'hero' ? '1' : '2'}>${e(b.text)}</h${s.id === 'hero' ? '1' : '2'}>` : b.kind === 'paragraph' ? `<p>${e(b.text)}</p>` : b.kind === 'button' ? `<a class="button" href="${e(b.href)}">${e(b.text)}</a>` : b.kind === 'list' ? `<ul>${b.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : b.asset && b.image ? `<div class="image"><img src="${e(imageUrl(b))}" alt="${e(b.alt)}" width="${b.image.width}" height="${b.image.height}">${b.unresolved ? `<small>Accessibility exception: ${e(b.unresolved)}</small>` : ''}</div>` : `<div class="image missing">Unresolved image: ${e(b.unresolved)}</div>`)).join('')}</div></div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(c.title)}</title><meta name="description" content="${e(c.description)}"><style>${css}</style></head><body><a class="skip" href="#main">Skip to content</a><header><strong>${e(c.title)}</strong><nav aria-label="Page sections">${c.sections.map((s) => `<a href="#${s.id}">${s.id[0]!.toUpperCase() + s.id.slice(1)}</a>`).join('')}</nav></header><main id="main">${sections}</main><footer><small>Fictional service-business composition · synthetic content</small></footer></body></html>`;
}
