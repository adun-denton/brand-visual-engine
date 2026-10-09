import sharp from 'sharp';
import type { Workspace } from '../src/service/workspace.ts';
import type {
  DesignArtifact,
  IterationBundle,
  NodePacket,
  VersionRef,
} from '../src/kernel/contracts.ts';
import type {
  NativeJob,
  ImageState,
} from '../src/modules/website/workspace-contracts.ts';
import type {
  CompositionState,
  SectionId,
} from '../src/modules/website/composition.ts';
import { reference } from '../src/kernel/packets.ts';
/** Authored synthetic raster receipt: no host call, provider, credential or generated client asset. */
export async function syntheticCompositionImage(
  color = '#de8159',
): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg width="720" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="480" fill="#e8dfca"/><rect x="90" y="110" width="340" height="300" rx="36" fill="${color}"/><circle cx="455" cy="215" r="145" fill="#173f45"/><rect x="480" y="250" width="150" height="160" rx="20" fill="#f3ede0"/><circle cx="320" cy="170" r="35" fill="#f3ede0"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}
export async function seedComposition(w: Workspace) {
  const p = w.create({
    title: 'Fieldwork composition fixture',
    mode: 'branded',
    visualOS: null,
    palette: ['#173f45', '#f3ede0', '#de8159'],
  }).project!;
  const initial = w.explore(p.id, {
    expectedProject: reference(p),
    count: 3,
    base: null,
  });
  const bundle = initial.bundles!.at(-1) as NodePacket<IterationBundle>,
    direction = bundle.payload.candidates[1]!;
  const chosen = w.select(p.id, {
    bundle: reference(bundle),
    candidate: direction,
    reason: 'Selected synthetic balanced direction for composition.',
  });
  w.accept(p.id, {
    artifact: direction,
    bundle: reference(chosen.bundles!.at(-1)!),
    expected: null,
    reason: 'Synthetic technical direction acceptance.',
    slot: 'design',
    allowHistorical: false,
  });
  const image = async (
    scope: SectionId,
    color: string,
  ): Promise<VersionRef> => {
    const request = w.native(p.id, {
      expectedProject: reference(p),
      artifact: direction,
      scope,
      instructions: 'Authored synthetic shape raster, no native host call.',
      preservation: [],
      references: [],
    });
    const job = request
      .artifacts!.filter((a) => a.payload.kind === 'website-native-job')
      .at(-1) as NodePacket<DesignArtifact<NativeJob>>;
    const result = await w.importNative(
      p.id,
      {
        job: reference(job),
        manifestProject: reference(p),
        originalArtifact: direction,
      },
      await syntheticCompositionImage(color),
    );
    return (
      result.artifacts!.find(
        (a) => a.payload.kind === 'website-native-job' && a.id === job.id,
      )!.payload.state as NativeJob
    ).outputs[0]!;
  };
  const hero = await image('hero', '#de8159'),
    replacement = await image('hero', '#aab982'),
    services = await image('services', '#ba9c84'),
    proof = await image('proof', '#80999c'),
    contact = await image('contact', '#bcad77');
  return {
    project: p,
    direction,
    assets: { hero, replacement, services, proof, contact },
  };
}
export const latestComposition = (w: Workspace, pid: string) =>
  w
    .state(pid)
    .artifacts!.filter((a) => a.payload.kind === 'website-composition')
    .at(-1) as NodePacket<DesignArtifact<CompositionState>>;
export function placeImages(
  w: Workspace,
  pid: string,
  state: CompositionState,
  assets: Record<SectionId, VersionRef>,
) {
  const content = structuredClone(state.content);
  for (const s of content.sections) {
    let b = s.blocks.find((b) => b.kind === 'image');
    if (!b) {
      b = {
        id: s.id + '-image',
        kind: 'image',
        text: '',
        href: '',
        items: [],
        asset: null,
        image: null,
        alt: '',
        unresolved: 'Unresolved',
      };
      s.blocks.push(b);
    }
    b.asset = assets[s.id];
    b.image = (w.read(pid, b.asset).payload.state as ImageState).image;
    b.alt = 'Authored synthetic geometric home-care illustration for ' + s.id;
    b.unresolved = '';
  }
  return content;
}
