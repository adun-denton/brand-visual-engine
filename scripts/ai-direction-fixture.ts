/** Authored transport/mechanical fixture only; never a production direction executor. */
import type { AIResponse } from '../src/modules/website/ai-contracts.ts';
import type { ModuleProject, NodePacket } from '../src/kernel/contracts.ts';
import { sectionIds } from '../src/modules/website/composition.ts';
export function aiFixture(p: NodePacket<ModuleProject>, count = 2): AIResponse {
  const intent = String(
    p.payload.resolvedContext.fields['intent']!.effective!.value,
  );
  const content = p.payload.resolvedContext.fields['content']!.effective!
    .value as string[];
  const block = (
    id: string,
    kind: 'heading' | 'paragraph' | 'list' | 'button' | 'image',
    text = '',
    items: string[] = [],
  ) => ({
    id,
    kind,
    text,
    href: kind === 'button' ? '#contact' : '',
    items,
    asset: null,
    image: null,
    alt: '',
    unresolved:
      kind === 'image'
        ? 'Synthetic fixture image missing; choose exact owned bytes.'
        : '',
  });
  return {
    schema: 'bve.ai-directions',
    version: 1,
    candidates: Array.from({ length: count }, (_, i) => ({
      title: 'Authored test direction ' + (i + 1),
      rationale:
        'Mechanical fixture for structured direction/asset contracts; not an AI generation claim.',
      constraints: ['Four bounded section identities; no real service claims.'],
      uncertainty:
        'Synthetic fixture only; designer and actual AI evidence separate.',
      unresolved: ['No verified service business or designer approval.'],
      page: {
        title: 'Fieldwork synthetic fixture',
        description: 'Authored test fixture; no live provider call.',
        style: {
          background: '#f3ede0',
          foreground: '#173f45',
          accent: '#173f45',
          actionText: '#f3ede0',
          font: i % 2 ? 'serif' : 'system',
          bodySize: 18,
          headingSize: i % 2 ? 48 : 64,
          spacing: i % 2 ? 60 : 88,
          radius: i % 2 ? 0 : 24,
          maxWidth: 1120,
        },
        sections: sectionIds.map((id) => ({
          id,
          recipe:
            id === 'hero' ? 'split' : id === 'services' ? 'cards' : 'stack',
          align: 'left',
          fit: 'contain',
          overrides: id === 'proof' ? { spacing: 48 } : {},
          blocks: [
            block(
              id + '-title',
              'heading',
              id === 'hero'
                ? 'A calmer home, one visit at a time.'
                : id === 'services'
                  ? 'Practical care'
                  : id === 'proof'
                    ? 'Evidence still needed'
                    : 'Plan a conversation',
            ),
            ...(id === 'hero'
              ? [
                  block(id + '-intent', 'paragraph', intent),
                  block(id + '-action', 'button', 'Talk about your home'),
                ]
              : id === 'services'
                ? [block(id + '-list', 'list', '', content)]
                : [
                    block(
                      id + '-text',
                      'paragraph',
                      id === 'proof'
                        ? 'Proof remains unresolved; no fabricated testimonial.'
                        : 'Contact details remain unresolved.',
                    ),
                  ]),
            block(id + '-image', 'image'),
          ],
        })),
        unresolved: ['Synthetic content; contact/proof unresolved.'],
      },
      imageNeeds: sectionIds.map((section) => ({
        section,
        role:
          section === 'hero'
            ? 'Calm welcome scene'
            : 'Supporting ' + section + ' scene',
        prompt:
          'Create an AI image for ' +
          section +
          ' under direction ' +
          (i + 1) +
          ', with calm negative space and no claims.',
        size: section === 'hero' ? '1536x1024' : '1024x1024',
        preservation: ['Retain pinned intent; no fabricated testimonials.'],
        references: [],
      })),
    })),
  };
}
