import sharp from 'sharp';
import type { Workspace } from './workspace.ts';
import type { Providers } from './providers.ts';
import { artifact } from './providers.ts';
import { decode } from './assets.ts';
import type { Assets } from './assets.ts';
import type { KernelStore } from '../kernel/store.ts';
import type {
  DesignArtifact,
  NodePacket,
  VersionRef,
  ModuleProject,
} from '../kernel/contracts.ts';
import type {
  NativeJob,
  ImageState,
} from '../modules/website/workspace-contracts.ts';
import type { ProviderJob } from '../modules/website/provider-contracts.ts';
import type {
  RegionSelection,
  RegionOperation,
  RegionImage,
  RegionComparison,
  Bounds,
} from '../modules/website/region-contracts.ts';
import {
  REGION_DECODING,
  pinned,
  parseBounds,
  parseSelection,
  parseOperation,
  parseRegionImage,
  parseRegionComparison,
  resolveRecipe,
} from '../modules/website/region-contracts.ts';
import {
  MAX_REGION_PIXELS,
  validateBinaryMask,
  compositePixels,
  outsidePixelDifference,
} from '../kernel/raster.ts';
import type { PixelRaster } from '../kernel/raster.ts';
import { canonical, packet } from '../kernel/packets.ts';
import { reference, revise } from '../kernel/packets.ts';
import { checksum } from '../kernel/raster.ts';
import { InputError, record, string, choice, list } from './validation.ts';
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const imageKinds = [
  'website-image',
  'website-api-image',
  'website-region-image',
];
export function drawMask(
  width: number,
  height: number,
  shape: 'rectangle' | 'ellipse',
  bounds: Bounds,
): Buffer {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_REGION_PIXELS
  )
    throw new InputError('Region editing is bounded at 4 MP');
  parseBounds(bounds, width, height);
  const mask = Buffer.alloc(width * height);
  for (let y = bounds.y; y < bounds.y + bounds.height; y++)
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const dx = (x + 0.5 - bounds.x - bounds.width / 2) / (bounds.width / 2);
      const dy = (y + 0.5 - bounds.y - bounds.height / 2) / (bounds.height / 2);
      if (shape === 'rectangle' || dx * dx + dy * dy <= 1)
        mask[y * width + x] = 1;
    }
  validateBinaryMask(mask, width, height);
  return mask;
}
export async function canonicalPixels(bytes: Buffer): Promise<PixelRaster> {
  const image = sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: MAX_REGION_PIXELS,
    animated: true,
  });
  const m = await image.metadata();
  if (
    !m.width ||
    !m.height ||
    (m.pages ?? 1) !== 1 ||
    m.width * m.height > MAX_REGION_PIXELS
  )
    throw new InputError('Region editing requires a single image at most 4 MP');
  const decoded = await image
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 4)
    throw new InputError('Canonical RGBA decoding failed');
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    channels: 4,
    pixels: decoded.data,
  };
}
function instructions(
  s: RegionSelection,
  o: Pick<RegionOperation, 'instructions' | 'recipe' | 'preservation'>,
): string {
  const intent =
    o.recipe.preset === 'preserve-form-change-finish'
      ? 'Preserve form; change only the requested finish.'
      : o.recipe.preset === 'explore'
        ? 'Explore an alternative treatment within the selected area.'
        : 'Edit the selected area.';
  return `${intent}\n${o.instructions}\nSource-pixel ${s.shape}: ${JSON.stringify(s.bounds)}, ${s.width}x${s.height}, pixel-top-left, ${s.decoding}.\n${o.recipe.path === 'native' ? 'Use the separately exported mask as guidance; the host may ignore it.' : 'This API adapter has no mask input; coordinates are instruction guidance only.'}\nPreserve outside content for review. Exact preservation is available only through a separate hard-edge local composite, never a provider guarantee.`;
}
/** Synchronous ownership/type/immutable-input checks shared by construction and Workspace consumption. */
export function validateRegionLinks(
  p: NodePacket<DesignArtifact<unknown>>,
  kernel: KernelStore,
  assets: Assets,
): void {
  if (!p.payload.kind.startsWith('website-region-')) return;
  const known = <T>(
    pointer: VersionRef,
    kind?: string,
    scope = p.payload.scope,
  ): NodePacket<DesignArtifact<T>> => {
    const a = kernel.get<DesignArtifact<T>>(pointer);
    if (
      a.projectId !== p.projectId ||
      a.type !== 'design-artifact' ||
      (kind && a.payload.kind !== kind) ||
      a.payload.scope !== scope
    )
      throw new InputError('Region link owner/type/scope mismatch');
    return a;
  };
  const image = (pointer: VersionRef) => {
    const a = known<ImageState>(pointer);
    if (!imageKinds.includes(a.payload.kind))
      throw new InputError('Region source must be an image candidate');
    return a;
  };
  if (p.payload.kind === 'website-region-selection') {
    const s = parseSelection(p.payload.state),
      a = image(s.source);
    if (
      !equal(a.payload.state.image, s.image) ||
      !equal(
        p.assets.map((a) => ({ id: a.id, checksum: a.checksum })),
        [s.image, s.mask].map((a) => ({ id: a.id, checksum: a.checksum })),
      )
    )
      throw new InputError('Selection source/mask asset mismatch');
    const mask = assets.read(s.mask.id);
    validateBinaryMask(mask, s.width, s.height);
    if (!mask.equals(drawMask(s.width, s.height, s.shape, s.bounds)))
      throw new InputError('Mask annotation geometry mismatch');
  } else if (p.payload.kind === 'website-region-operation') {
    const o = parseOperation(p.payload.state),
      s = known<RegionSelection>(o.selection, 'website-region-selection')
        .payload.state;
    image(o.source);
    const project = kernel.get<ModuleProject>(o.project);
    if (
      project.type !== 'module-project' ||
      project.id !== p.projectId ||
      !equal(o.source, s.source)
    )
      throw new InputError('Region operation source/project mismatch');
    const execution = known<NativeJob | ProviderJob>(
      o.execution,
      o.recipe.path === 'native'
        ? 'website-native-job'
        : 'website-provider-job',
    );
    const request =
      o.recipe.path === 'native'
        ? (execution.payload.state as NativeJob).manifest
        : (execution.payload.state as ProviderJob).request;
    if (
      !equal(request.project, o.project) ||
      !equal(request.artifact, o.source) ||
      !equal(request.inputAsset, s.image) ||
      !equal(request.references, o.references) ||
      request.instructions !== instructions(s, o) ||
      !equal(request.selection, o.selectedAtStart)
    )
      throw new InputError('Region execution provenance mismatch');
    if (o.recipe.path === 'api') {
      const req = (execution.payload.state as ProviderJob).request;
      if (
        req.operation !== 'edit' ||
        req.settings.size !== o.recipe.controls!.size ||
        req.settings.quality !== o.recipe.controls!.quality
      )
        throw new InputError('Region controls/execution mismatch');
    }
    for (const r of o.references) {
      const a = known<ImageState>(r.artifact, 'website-reference', r.scope);
      if (
        !r.selected ||
        ![p.payload.scope, 'landing-page'].includes(r.scope) ||
        !equal(a.payload.state.image, r.image)
      )
        throw new InputError('Region reference binding mismatch');
    }
    if (new Set(o.outputs.map((r) => r.id)).size !== o.outputs.length)
      throw new InputError('Duplicate region output');
    for (const r of o.outputs)
      if (
        known<RegionImage>(r, 'website-region-image').payload.state.operation
          .id !== p.id
      )
        throw new InputError('Region output operation mismatch');
    const original = kernel.lookup({
      id: p.id,
      version: 1,
      freshness: 'pinned',
    }) as NodePacket<DesignArtifact<RegionOperation>> | null;
    if (
      original &&
      !equal({ ...original.payload.state, outputs: [] }, { ...o, outputs: [] })
    )
      throw new InputError('Region request is immutable');
  } else if (p.payload.kind === 'website-region-image') {
    const r = parseRegionImage(p.payload.state),
      o = known<RegionOperation>(r.operation, 'website-region-operation')
        .payload.state;
    const s = known<RegionSelection>(r.selection, 'website-region-selection')
      .payload.state;
    const raw = image(r.raw).payload.state;
    if (
      !equal(r.source, o.source) ||
      !equal(r.selection, o.selection) ||
      !equal(r.parentAsset, s.image) ||
      !equal(raw.originalArtifact, o.source) ||
      raw.job?.id !== o.execution.id ||
      !equal(
        p.assets.map((a) => ({ id: a.id, checksum: a.checksum })),
        [{ id: r.image.id, checksum: r.image.checksum }],
      ) ||
      (r.variant === 'raw' && !equal(r.image, raw.image))
    )
      throw new InputError('Region candidate lineage mismatch');
  } else if (p.payload.kind === 'website-region-comparison') {
    const c = parseRegionComparison(p.payload.state),
      o = known<RegionOperation>(c.operation, 'website-region-operation')
        .payload.state;
    if (!equal(c.source, o.source) || !equal(c.selection, o.selection))
      throw new InputError('Region comparison source mismatch');
    for (const r of c.compared)
      if (
        known<RegionImage>(r, 'website-region-image').payload.state.operation
          .id !== c.operation.id
      )
        throw new InputError('Compare candidates from this operation');
  } else throw new InputError('Unknown region kind');
}
export class Regions {
  workspace: Workspace;
  providers: Providers;
  constructor(workspace: Workspace, providers: Providers) {
    this.workspace = workspace;
    this.providers = providers;
  }
  private selection(pid: string, pointer: VersionRef) {
    const a = this.workspace.read(pid, pointer);
    if (a.payload.kind !== 'website-region-selection')
      throw new InputError('Not a region selection');
    return a as NodePacket<DesignArtifact<RegionSelection>>;
  }
  private operation(pid: string, pointer: VersionRef) {
    const a = this.workspace.read(pid, pointer);
    if (a.payload.kind !== 'website-region-operation')
      throw new InputError('Not a region operation');
    return a as NodePacket<DesignArtifact<RegionOperation>>;
  }
  private current(pid: string, pointer: VersionRef): void {
    if (this.workspace.kernel.currentVersion(pointer.id) !== pointer.version)
      throw new InputError(
        'Region changed; reload and review the current version',
        409,
      );
    this.workspace.read(pid, pointer);
  }
  private activeSelection(pid: string, scope: string): VersionRef | null {
    for (const event of this.workspace.kernel.ledger(pid).events.toReversed()) {
      if (event.kind !== 'revision') continue;
      const a = this.workspace.kernel.lookup(event.subject) as NodePacket<
        DesignArtifact<unknown>
      > | null;
      if (
        a?.projectId === pid &&
        a.type === 'design-artifact' &&
        a.payload.kind === 'website-region-selection' &&
        a.payload.scope === scope
      )
        return event.subject;
    }
    return null;
  }
  private eligible(
    pid: string,
    operation: NodePacket<DesignArtifact<RegionOperation>>,
  ): void {
    const o = operation.payload.state;
    this.workspace.project(pid, o.project);
    this.current(pid, o.selection);
    if (!equal(this.activeSelection(pid, operation.payload.scope), o.selection))
      throw new InputError(
        'Region changed; a newer section selection is active',
        409,
      );
    this.current(pid, o.source);
    if (
      !equal(
        o.selectedAtStart,
        this.workspace.kernel.selected(pid, operation.payload.scope),
      )
    )
      throw new InputError(
        'Accepted image changed; keep both candidates and prepare a fresh reviewed operation',
        409,
      );
    const execution = this.workspace.read(pid, {
      ...o.execution,
      version: this.workspace.kernel.currentVersion(o.execution.id)!,
    });
    const state = execution.payload.state as NativeJob | ProviderJob;
    if (state.status !== 'returned')
      throw new InputError(
        'Execution is not an eligible returned request',
        409,
      );
  }
  async select(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'source',
      'previous',
      'expectedSelection',
      'width',
      'height',
      'coordinateSystem',
      'shape',
      'bounds',
      'mask',
    ]);
    const project = this.workspace.project(pid, r['expectedProject']),
      source = this.workspace.read(pid, pinned(r['source']));
    if (!imageKinds.includes(source.payload.kind))
      throw new InputError('Select an owned section image');
    this.current(pid, reference(source));
    const previous =
      r['previous'] === null
        ? null
        : this.selection(pid, pinned(r['previous']));
    if (previous) {
      this.current(pid, reference(previous));
      if (!equal(previous.payload.state.source, reference(source)))
        throw new InputError('A new source needs a new selection');
    }
    const expectedSelection =
      r['expectedSelection'] === null ? null : pinned(r['expectedSelection']);
    const writeGuard = () => {
      this.workspace.project(pid, r['expectedProject']);
      this.current(pid, reference(source));
      if (previous) this.current(pid, reference(previous));
      if (
        !equal(
          this.activeSelection(pid, source.payload.scope),
          expectedSelection,
        )
      )
        throw new InputError(
          'Region changed; reload the current section selection before saving',
          409,
        );
      if (
        !previous &&
        this.workspace.kernel
          .latestPackets()
          .some(
            (a) =>
              a.projectId === pid &&
              a.type === 'design-artifact' &&
              (a.payload as DesignArtifact<RegionSelection>).kind ===
                'website-region-selection' &&
              equal(
                (a.payload as DesignArtifact<RegionSelection>).state.source,
                reference(source),
              ),
          )
      )
        throw new InputError(
          'Source selection exists; revise its current version',
          409,
        );
    };
    const original = await this.workspace.originalImage(pid, reference(source)),
      raster = await canonicalPixels(original.bytes);
    if (
      r['width'] !== raster.width ||
      r['height'] !== raster.height ||
      r['coordinateSystem'] !== 'pixel-top-left'
    )
      throw new InputError(
        'Selection dimensions/coordinates do not match the oriented source',
      );
    const shape = choice(r['shape'], ['rectangle', 'ellipse']),
      bounds = parseBounds(r['bounds'], raster.width, raster.height);
    const mask = drawMask(raster.width, raster.height, shape, bounds);
    if (r['mask'] !== undefined) {
      const encoded = string(
        r['mask'],
        Math.ceil(MAX_REGION_PIXELS / 3) * 4 + 4,
      );
      const supplied = Buffer.from(encoded, 'base64');
      if (supplied.toString('base64') !== encoded)
        throw new InputError('Non-canonical mask encoding');
      validateBinaryMask(supplied, raster.width, raster.height);
      if (!supplied.equals(mask))
        throw new InputError('Mask differs from selected geometry');
    }
    this.workspace.project(pid, r['expectedProject']);
    this.current(pid, reference(source));
    if (previous) this.current(pid, reference(previous));
    const hash = checksum(mask),
      s: RegionSelection = {
        source: reference(source),
        image: original.info,
        width: raster.width,
        height: raster.height,
        coordinateSystem: 'pixel-top-left',
        decoding: REGION_DECODING,
        shape,
        bounds,
        mask: { id: hash, checksum: hash, bytes: mask.length },
      };
    const a = previous
      ? revise(
          previous,
          { ...previous.payload, state: s },
          'local-operator',
          'Revise annotation overlay selection',
        )
      : artifact(
          pid,
          'website-region-selection',
          source.payload.scope,
          s,
          [reference(source), reference(project)],
          [s.image, s.mask],
        );
    // A revised mask changes the owned mask asset pointer as well as its payload.
    const { integrity: _, ...body } = a;
    const selection = packet<DesignArtifact<RegionSelection>>({
      ...body,
      assets: [s.image, s.mask].map((x) => ({
        id: x.id,
        checksum: x.checksum,
      })),
    });
    this.workspace.assets.save(mask, s.mask);
    this.workspace.kernel.putMany([selection], writeGuard);
    return this.workspace.state(pid);
  }
  prepare(pid: string, input: unknown) {
    const r = record(input, [
      'expectedProject',
      'selection',
      'instructions',
      'preservation',
      'preset',
      'path',
      'controls',
      'references',
    ]);
    const p = this.workspace.project(pid, r['expectedProject']),
      selection = this.selection(pid, pinned(r['selection']));
    this.current(pid, reference(selection));
    if (
      !equal(
        this.activeSelection(pid, selection.payload.scope),
        reference(selection),
      )
    )
      throw new InputError(
        'Region changed; save a current section selection before preparing',
        409,
      );
    this.current(pid, selection.payload.state.source);
    const recipe = resolveRecipe(r['preset'], r['path'], r['controls']);
    const operationBase = {
      project: reference(p),
      source: selection.payload.state.source,
      selection: reference(selection),
      instructions: string(r['instructions'], 2000),
      preservation: choice(r['preservation'], [
        'review-raw',
        'strict-composite',
      ]),
      recipe,
      selectedAtStart: this.workspace.kernel.selected(
        pid,
        selection.payload.scope,
      ),
      outputs: [],
    };
    const references = list(r['references'], pinned, 4);
    const companion = (
      j: NodePacket<DesignArtifact<NativeJob | ProviderJob>>,
    ) => {
      const request =
        recipe.path === 'native'
          ? (j.payload.state as NativeJob).manifest
          : (j.payload.state as ProviderJob).request;
      return [
        artifact(
          pid,
          'website-region-operation',
          selection.payload.scope,
          {
            ...operationBase,
            execution: reference(j),
            references: request.references,
          } as RegionOperation,
          [
            reference(p),
            reference(selection),
            selection.payload.state.source,
            reference(j),
            ...references,
          ],
        ),
      ];
    };
    const inputBase = {
      expectedProject: reference(p),
      artifact: operationBase.source,
      scope: selection.payload.scope,
      instructions: instructions(selection.payload.state, operationBase),
      references,
    };
    if (recipe.path === 'native')
      return this.workspace.native(
        pid,
        {
          ...inputBase,
          preservation: [
            'Region mask is guidance only',
            operationBase.preservation,
          ],
        },
        companion,
      );
    return this.providers.prepare(
      pid,
      {
        ...inputBase,
        operation: 'edit',
        size: recipe.controls!.size,
        quality: recipe.controls!.quality,
      },
      companion,
    );
  }
  collect(pid: string, input: unknown) {
    const r = record(input, ['operation', 'raw']),
      operation = this.operation(pid, pinned(r['operation']));
    this.current(pid, reference(operation));
    const o = operation.payload.state,
      raw = this.workspace.read(pid, pinned(r['raw']));
    const inner = this.workspace.read(pid, {
      ...o.execution,
      version: this.workspace.kernel.currentVersion(o.execution.id)!,
    });
    const state = inner.payload.state as NativeJob | ProviderJob;
    if (
      !state.outputs.some((x) => equal(x, reference(raw))) ||
      !['website-image', 'website-api-image'].includes(raw.payload.kind)
    )
      throw new InputError('Raw result is not an output of this execution');
    const image = raw.payload.state as ImageState;
    if (
      !equal(image.originalArtifact, o.source) ||
      image.job?.id !== o.execution.id ||
      raw.payload.scope !== operation.payload.scope
    )
      throw new InputError('Raw source binding mismatch');
    if (
      o.outputs.some((x) =>
        equal(
          (this.workspace.read(pid, x).payload.state as RegionImage).raw,
          reference(raw),
        ),
      )
    )
      throw new InputError('Result already collected', 409);
    const selection = this.selection(pid, o.selection).payload.state;
    const result: RegionImage = {
      image: image.image,
      source: o.source,
      operation: reference(operation),
      selection: o.selection,
      raw: reference(raw),
      parentAsset: selection.image,
      variant: 'raw',
      decoding: REGION_DECODING,
      boundary: 'hard-edge-no-blend',
      outsideDifference: null,
    };
    const candidate = artifact(
      pid,
      'website-region-image',
      operation.payload.scope,
      result,
      [o.source, o.selection, reference(operation), reference(raw)],
      [result.image],
    );
    this.workspace.kernel.putMany([
      candidate,
      revise(
        operation,
        {
          ...operation.payload,
          state: { ...o, outputs: [...o.outputs, reference(candidate)] },
        },
        'local-operator',
        'Retain raw region result; no acceptance',
      ),
    ]);
    return this.workspace.state(pid);
  }
  async compose(pid: string, input: unknown) {
    const r = record(input, ['candidate']),
      a = this.workspace.read(pid, pinned(r['candidate']));
    if (a.payload.kind !== 'website-region-image')
      throw new InputError('Not a region candidate');
    const state = parseRegionImage(a.payload.state),
      operation = this.operation(pid, {
        ...state.operation,
        version: this.workspace.kernel.currentVersion(state.operation.id)!,
      });
    if (
      state.variant !== 'raw' ||
      operation.payload.state.preservation !== 'strict-composite'
    )
      throw new InputError(
        'Choose an explicit strict-composite operation and its raw candidate',
      );
    if (
      operation.payload.state.outputs.some((x) => {
        const s = this.workspace.read(pid, x).payload.state as RegionImage;
        return s.variant === 'strict-composite' && equal(s.raw, state.raw);
      })
    )
      throw new InputError('Composite already exists', 409);
    const selection = this.selection(pid, state.selection).payload.state;
    const source = await canonicalPixels(
        (await this.workspace.originalImage(pid, state.source)).bytes,
      ),
      raw = await canonicalPixels(
        (await this.workspace.originalImage(pid, state.raw)).bytes,
      );
    if (source.width !== selection.width || source.height !== selection.height)
      throw new InputError('Source geometry changed; reselect');
    if (raw.width !== source.width || raw.height !== source.height)
      throw new InputError(
        'Candidate geometry changed; provide an explicitly aligned result or a new source and selection',
      );
    const mask = this.workspace.assets.read(selection.mask.id);
    const composite = compositePixels(source, raw, mask);
    const png = await sharp(composite.pixels, {
      raw: { width: composite.width, height: composite.height, channels: 4 },
    })
      .png()
      .toBuffer();
    const decoded = await canonicalPixels(png),
      difference = outsidePixelDifference(source, decoded, mask);
    if (difference.rgb || difference.alpha)
      throw new InputError('Strict composite preservation check failed');
    const info = await decode(png);
    this.current(pid, reference(operation));
    const result: RegionImage = {
      ...state,
      image: info,
      operation: reference(operation),
      variant: 'strict-composite',
      outsideDifference: difference,
    };
    const candidate = artifact(
      pid,
      'website-region-image',
      a.payload.scope,
      result,
      [
        state.source,
        state.raw,
        state.selection,
        reference(a),
        reference(operation),
      ],
      [info],
    );
    this.workspace.assets.save(png, info);
    this.workspace.kernel.putMany([
      candidate,
      revise(
        operation,
        {
          ...operation.payload,
          state: {
            ...operation.payload.state,
            outputs: [...operation.payload.state.outputs, reference(candidate)],
          },
        },
        'local-operator',
        'Retain separate strict composite; no acceptance',
      ),
    ]);
    return this.workspace.state(pid);
  }
  compare(pid: string, input: unknown) {
    const r = record(input, ['operation', 'compared', 'selected', 'reason']),
      op = this.operation(pid, pinned(r['operation']));
    const c = parseRegionComparison({
      ...r,
      source: op.payload.state.source,
      selection: op.payload.state.selection,
    });
    for (const pointer of c.compared) {
      const a = this.workspace.read(pid, pointer);
      if (
        a.payload.kind !== 'website-region-image' ||
        (a.payload.state as RegionImage).operation.id !== op.id ||
        !op.payload.state.outputs.some((x) => equal(x, pointer))
      )
        throw new InputError('Candidate is not in this operation');
    }
    this.workspace.kernel.put(
      artifact(pid, 'website-region-comparison', op.payload.scope, c, [
        reference(op),
        c.source,
        c.selection,
        ...c.compared,
      ]),
    );
    return this.workspace.state(pid);
  }
  async accept(pid: string, input: unknown) {
    const r = record(input, ['candidate', 'expected', 'reason']),
      a = this.workspace.read(pid, pinned(r['candidate']));
    if (a.payload.kind !== 'website-region-image')
      throw new InputError('Not a region candidate');
    const s = parseRegionImage(a.payload.state),
      op = this.operation(pid, {
        ...s.operation,
        version: this.workspace.kernel.currentVersion(s.operation.id)!,
      });
    if (!op.payload.state.outputs.some((x) => equal(x, reference(a))))
      throw new InputError('Unrecorded region output');
    this.eligible(pid, op);
    if (
      op.payload.state.preservation === 'strict-composite' &&
      s.variant !== 'strict-composite'
    )
      throw new InputError('Strict operation requires its verified composite');
    if (s.variant === 'strict-composite') {
      const source = await canonicalPixels(
        (await this.workspace.originalImage(pid, s.source)).bytes,
      );
      const composite = await canonicalPixels(
        (await this.workspace.originalImage(pid, reference(a))).bytes,
      );
      const selection = this.selection(pid, s.selection).payload.state;
      if (
        source.width !== selection.width ||
        source.height !== selection.height
      )
        throw new InputError('Invalid source geometry');
      const difference = outsidePixelDifference(
        source,
        composite,
        this.workspace.assets.read(selection.mask.id),
      );
      if (difference.rgb || difference.alpha)
        throw new InputError('Strict preservation no longer verifies');
    }
    this.eligible(pid, op); // Revalidate after decoding; no await before transactional compare-and-swap.
    this.workspace.kernel.accept(
      pid,
      a.payload.scope,
      reference(a),
      r['expected'] === null ? null : pinned(r['expected']),
      'local-operator',
      string(r['reason'], 500),
      null,
      () => {
        this.eligible(pid, op);
        this.workspace.assets.read(s.image.id);
        this.workspace.assets.read(s.parentAsset.id);
      },
    );
    return this.workspace.state(pid);
  }
  async bundle(pid: string, pointer: VersionRef) {
    const op = this.operation(pid, pointer),
      o = op.payload.state;
    if (o.recipe.path !== 'native')
      throw new InputError('Only native operations export a manual bundle');
    const s = this.selection(pid, o.selection).payload.state;
    const inputs = [o.source, ...o.references.map((r) => r.artifact)];
    const descriptors = [s.image, ...o.references.map((r) => r.image)];
    const mask = this.workspace.assets.read(s.mask.id);
    if (
      descriptors.reduce((n, d) => n + d.bytes, mask.length) >
      16 * 1024 * 1024
    )
      throw new InputError(
        'Native bundle exceeds 16 MiB of original inputs; select fewer references',
        413,
      );
    const sourcePixels = await canonicalPixels(
      (await this.workspace.originalImage(pid, o.source)).bytes,
    );
    if (sourcePixels.width !== s.width || sourcePixels.height !== s.height)
      throw new InputError('Selection source geometry mismatch');
    const files = [];
    for (let i = 0; i < inputs.length; i++) {
      const original = await this.workspace.originalImage(pid, inputs[i]!);
      if (!equal(original.info, descriptors[i]))
        throw new InputError('Export input binding mismatch');
      files.push({
        artifact: inputs[i],
        image: original.info,
        role: i === 0 ? 'source' : o.references[i - 1]!.role,
        data: original.bytes.toString('base64'),
      });
    }
    const guide = await sharp(Buffer.from(mask.map((v) => v * 255)), {
      raw: { width: s.width, height: s.height, channels: 1 },
    })
      .png()
      .toBuffer();
    return {
      operation: reference(op),
      request: o,
      selection: s,
      native: this.workspace.manifest(pid, o.execution),
      encoding:
        'base64 original file bytes; mask.bin values 0/1, one per source pixel',
      files,
      mask: { ...s.mask, data: mask.toString('base64') },
      maskGuidancePNG: {
        checksum: checksum(guide),
        data: guide.toString('base64'),
      },
      warning:
        'Mask is host guidance only. Strict outside RGBA preservation requires the separate explicit local hard-edge composite.',
    };
  }
}
