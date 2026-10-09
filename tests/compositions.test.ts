import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  cpSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/service/workspace.ts';
import { Compositions, reviewNeeded } from '../src/service/compositions.ts';
import { reference, canonical, packet, revise } from '../src/kernel/packets.ts';
import {
  seedComposition,
  latestComposition,
  placeImages,
} from '../scripts/composition-fixture.ts';
import { sectionIds } from '../src/modules/website/composition.ts';
import { parseContent } from '../src/modules/website/composition-contracts.ts';
import { tar } from '../src/service/handoff.ts';
import { startApp } from '../src/service/server.ts';
import type { CompositionState } from '../src/modules/website/composition.ts';
const closed = new WeakSet<Workspace>();
const close = (w: Workspace) => {
  if (!closed.has(w)) {
    w.close();
    closed.add(w);
  }
};
async function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'bve-composition-'));
  let w = new Workspace(root);
  t.after(() => {
    close(w);
    rmSync(root, { recursive: true, force: true });
  });
  const fixture = await seedComposition(w),
    pid = fixture.project.id,
    c = new Compositions(w),
    project = reference(fixture.project);
  c.start(pid, {
    expectedProject: project,
    direction: fixture.direction,
    reason: 'Selected direction for synthetic page.',
  });
  let a = latestComposition(w, pid);
  await c.save(pid, {
    expectedProject: project,
    expected: reference(a),
    direction: fixture.direction,
    content: placeImages(w, pid, a.payload.state, fixture.assets),
    reason: 'Deliberate placed synthetic assets.',
  });
  a = latestComposition(w, pid);
  const save = async (
    content: unknown,
    expected = reference(latestComposition(w, pid)),
  ) =>
    c.save(pid, {
      expectedProject: reference(w.project(pid)),
      expected,
      direction: fixture.direction,
      content,
      reason: 'Meaningful candidate edit.',
    });
  const review = async () => {
    await c.review(pid, {
      expectedProject: reference(w.project(pid)),
      expected: reference(latestComposition(w, pid)),
      sections: sectionIds,
      reason:
        'AI technical review; all synthetic unresolved exceptions acknowledged.',
    });
    return latestComposition(w, pid);
  };
  const accept = async () => {
    const a = latestComposition(w, pid);
    return c.accept(pid, {
      expectedProject: reference(w.project(pid)),
      artifact: reference(a),
      expected: w.kernel.selected(pid, 'composition'),
      reason:
        'Explicitly accept exact synthetic page and unresolved exceptions.',
    });
  };
  return {
    root,
    w,
    c,
    fixture,
    pid,
    project,
    a,
    save,
    review,
    accept,
    reopen: () => {
      close(w);
      w = new Workspace(root);
      c.workspace = w;
      return w;
    },
  };
}
function files(bytes: Buffer) {
  const out = new Map<string, Buffer>();
  for (let n = 0; n < bytes.length - 1024; ) {
    const h = bytes.subarray(n, n + 512),
      name = h.toString('ascii', 0, 100).split('\0')[0]!,
      size = parseInt(h.toString('ascii', 124, 136).split('\0')[0]!, 8);
    out.set(name, bytes.subarray(n + 512, n + 512 + size));
    n += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
test('composition drafts, reviews and comparisons remain separate from exact acceptance', async (t) => {
  const { w, c, pid, a, review, accept } = await setup(t);
  assert.equal(w.kernel.selected(pid, 'composition'), null);
  await assert.rejects(() => c.export(pid, reference(a)), /acceptance/);
  await assert.rejects(accept, /Review/);
  const reviewed = await review();
  assert.deepEqual(reviewNeeded(reviewed.payload.state), []);
  assert.equal(w.kernel.selected(pid, 'composition'), null);
  c.compare(pid, {
    compared: [reference(a), reference(reviewed)],
    selected: reference(reviewed),
    reason: 'Inspect two exact drafts.',
  });
  assert.equal(w.kernel.selected(pid, 'composition'), null);
  await accept();
  assert.deepEqual(w.kernel.selected(pid, 'composition'), reference(reviewed));
  assert.equal(w.read(pid, reference(a)).version, a.version);
});
test('local text and exact asset replacement create immutable versions, preserve unaffected section reviews and accepted snapshot', async (t) => {
  const { w, c, pid, fixture, review, accept, save } = await setup(t);
  const accepted = await review();
  await accept();
  const before = await c.export(pid, reference(accepted));
  const content = structuredClone(accepted.payload.state.content),
    hero = content.sections[0]!;
  hero.blocks[0]!.text = 'Visible repaired hero';
  const b = hero.blocks.find((x) => x.kind === 'image')!;
  b.asset = fixture.assets.replacement;
  b.image = (
    w.read(pid, b.asset).payload.state as { image: typeof b.image }
  ).image;
  await save(content);
  const next = latestComposition(w, pid);
  assert.deepEqual(reviewNeeded(next.payload.state), ['hero']);
  for (const id of ['services', 'proof', 'contact'])
    assert.equal(
      canonical(next.payload.state.content.sections.find((s) => s.id === id)),
      canonical(
        accepted.payload.state.content.sections.find((s) => s.id === id),
      ),
    );
  assert.deepEqual(w.kernel.selected(pid, 'composition'), reference(accepted));
  assert.equal(
    (await c.export(pid, reference(accepted))).checksum,
    before.checksum,
  );
  assert.equal(
    canonical(w.read(pid, reference(accepted)).payload.state),
    canonical(accepted.payload.state),
  );
});
test('global changes invalidate only effective dependencies; explicit overrides survive; metadata and order invalidate all', async (t) => {
  const { w, pid, save, review } = await setup(t);
  let content = structuredClone(
    latestComposition(w, pid).payload.state.content,
  );
  content.sections.find((s) => s.id === 'proof')!.overrides.spacing = 72;
  await save(content);
  let a = await review();
  content = structuredClone(a.payload.state.content);
  content.style.spacing += 8;
  await save(content);
  assert.deepEqual(reviewNeeded(latestComposition(w, pid).payload.state), [
    'hero',
    'services',
    'contact',
  ]);
  a = await review();
  content = structuredClone(a.payload.state.content);
  [content.sections[1], content.sections[2]] = [
    content.sections[2]!,
    content.sections[1]!,
  ];
  await save(content);
  assert.deepEqual(
    reviewNeeded(latestComposition(w, pid).payload.state),
    sectionIds,
  );
  a = await review();
  content = structuredClone(a.payload.state.content);
  content.title = 'Changed title';
  await save(content);
  assert.deepEqual(
    reviewNeeded(latestComposition(w, pid).payload.state),
    sectionIds,
  );
});
test('stale concurrent saves and stale acceptance conflict without replacing newer work or ledger', async (t) => {
  const { w, c, pid, project, a, save, review, accept } = await setup(t);
  await review();
  const fresh = latestComposition(w, pid),
    events = w.kernel.ledger(pid).events.length;
  await assert.rejects(
    () => save(a.payload.state.content, reference(a)),
    /changed/,
  );
  await assert.rejects(
    () =>
      c.accept(pid, {
        expectedProject: project,
        artifact: reference(a),
        expected: null,
        reason: 'stale',
      }),
    /changed/,
  );
  assert.equal(w.kernel.ledger(pid).events.length, events);
  await accept();
  await assert.rejects(
    () =>
      c.accept(pid, {
        expectedProject: project,
        artifact: reference(fresh),
        expected: null,
        reason: 'Concurrent old pointer',
      }),
    /changed/,
  );
  assert.deepEqual(w.kernel.selected(pid, 'composition'), reference(fresh));
});
test('context revisions require rebase to current direction and fresh reviews; historical exports remain pinned', async (t) => {
  const { w, c, pid, project, review, accept, save } = await setup(t);
  const old = await review();
  await accept();
  const before = await c.export(pid, reference(old));
  w.reviseProject(pid, {
    expectedProject: project,
    brief: { offer: 'Revised synthetic offer' },
    reason: 'Explicit context edit.',
  });
  await assert.rejects(accept, /Rebase|current|direction|Review/);
  await assert.rejects(() => save(old.payload.state.content), /current brief/);
  const p = w.project(pid),
    state = w.explore(pid, {
      expectedProject: reference(p),
      count: 1,
      base: null,
    }),
    direction = (state.bundles!.at(-1)!.payload as { candidates: unknown[] })
      .candidates[0];
  await c.save(pid, {
    expectedProject: reference(p),
    expected: reference(old),
    direction,
    content: old.payload.state.content,
    reason: 'Rebase to new context and direction.',
  });
  assert.deepEqual(
    reviewNeeded(latestComposition(w, pid).payload.state),
    sectionIds,
  );
  assert.equal((await c.export(pid, reference(old))).checksum, before.checksum);
});
test('changed accepted-image pointer never substitutes placed bytes', async (t) => {
  const { w, c, pid, fixture, review, accept } = await setup(t);
  const a = await review();
  await accept();
  const before = await c.export(pid, reference(a));
  w.accept(pid, {
    artifact: fixture.assets.replacement,
    bundle: null,
    expected: null,
    reason: 'Separate deliberate hero image acceptance.',
    slot: 'hero',
    allowHistorical: false,
  });
  assert.equal((await c.export(pid, reference(a))).checksum, before.checksum);
  assert.deepEqual(
    a.payload.state.content.sections[0]!.blocks.find((b) => b.kind === 'image')!
      .asset,
    fixture.assets.hero,
  );
});
test('foreign and wrong-scope images reject without writes', async (t) => {
  const { w, pid, fixture, a, save } = await setup(t);
  const before = w.kernel.ledger(pid).events.length;
  let content = structuredClone(a.payload.state.content),
    b = content.sections[0]!.blocks.find((b) => b.kind === 'image')!;
  b.asset = fixture.assets.services;
  b.image = (
    w.read(pid, b.asset).payload.state as { image: typeof b.image }
  ).image;
  await assert.rejects(() => save(content), /scope/);
  const foreign = await seedComposition(w);
  b.asset = foreign.assets.hero;
  b.image = (
    w.read(foreign.project.id, b.asset).payload.state as {
      image: typeof b.image;
    }
  ).image;
  await assert.rejects(() => save(content), /different project/);
  assert.equal(w.kernel.ledger(pid).events.length, before);
});
test('corrupt and missing placed bytes fail clearly on preview/export without accepting a newer revision', async (t) => {
  const { w, c, pid, root, review, accept } = await setup(t);
  const a = await review();
  await accept();
  const img = a.payload.state.content.sections[0]!.blocks.find(
    (b) => b.image,
  )!.image!;
  // Resolve the implementation-owned file location from the asset store, not user input.
  const fs = await import('node:fs');
  const target = fs
    .readdirSync(w.assets.root)
    .find((n) => n.startsWith(img.id))!;
  writeFileSync(join(w.assets.root, target), Buffer.from('corrupt'));
  await assert.rejects(
    () => c.preview(pid, reference(a)),
    /corrupt|unavailable/,
  );
  await assert.rejects(
    () => c.export(pid, reference(a)),
    /corrupt|unavailable/,
  );
  fs.rmSync(join(w.assets.root, target));
  await assert.rejects(
    () => c.export(pid, reference(a)),
    /corrupt|unavailable/,
  );
  assert.deepEqual(w.kernel.selected(pid, 'composition'), reference(a));
});
test('validation rejects scripts, unsafe links, arbitrary style, bad contrast, duplicate IDs and absent accessibility notes', async (t) => {
  const { a } = await setup(t);
  const original = a.payload.state.content;
  for (const change of [
    (c: typeof original) => {
      c.sections[0]!.blocks.find((b) => b.kind === 'button')!.href =
        'javascript:alert(1)';
    },
    (c: typeof original) => {
      c.style.foreground = c.style.background;
    },
    (c: typeof original) => {
      c.sections[0]!.blocks[0]!.id = 'main';
    },
    (c: typeof original) => {
      const b = c.sections[0]!.blocks.find((b) => b.kind === 'image')!;
      b.alt = '';
      b.unresolved = '';
    },
    (c: typeof original) => {
      (c.style as unknown as Record<string, unknown>)['script'] = 'bad';
    },
  ]) {
    const c = structuredClone(original);
    change(c);
    assert.throws(() => parseContent(c));
  }
  const c = structuredClone(original);
  c.sections[0]!.blocks[0]!.text = '<script>alert(1)</script>';
  parseContent(c); // Text remains literal, not executable markup.
});
test('handoff contains deliberate bounded contents, original checksummed assets and same safe renderer, never runtime/provider/private records', async (t) => {
  const { w, c, pid, review, accept } = await setup(t);
  const a = await review();
  await accept();
  const output = await c.export(pid, reference(a)),
    f = files(output.bytes);
  assert.deepEqual(
    [...f.keys()].filter((k) => !k.startsWith('assets/')).sort(),
    ['RECONSTRUCT.md', 'index.html', 'manifest.json'],
  );
  const manifest = JSON.parse(f.get('manifest.json')!.toString());
  assert.equal(manifest.composition.version, a.version);
  assert.equal(manifest.assets.length, 4);
  assert.ok(manifest.unresolved.length);
  assert.equal(manifest.context.fields.references, undefined);
  assert.equal(manifest.directionState.parameters.references, undefined);
  for (const asset of manifest.assets) {
    const { createHash } = await import('node:crypto');
    assert.equal(
      createHash('sha256').update(f.get(asset.path)!).digest('hex'),
      asset.checksum,
    );
    assert.equal(f.get(asset.path)!.length, asset.bytes);
  }
  const joined = [...f]
    .filter(([p]) => !p.startsWith('assets/'))
    .map(([, b]) => b.toString())
    .join('');
  for (const disallowed of [
    'kernel.sqlite',
    'native-assets',
    'providerId',
    'apiKey',
    'sourceReferences',
    'outcomes',
    'transcripts',
  ])
    assert.ok(!joined.includes(disallowed));
  assert.ok(!f.get('index.html')!.toString().includes('<script'));
  assert.ok(!f.get('index.html')!.toString().includes('/api/v1'));
  assert.throws(
    () => tar(new Map([['../escape', Buffer.from('x')]])),
    /Unsafe/,
  );
  assert.throws(
    () => tar(new Map([['assets/private-original.png', Buffer.from('x')]])),
    /Unsafe/,
  );
  assert.throws(
    () => tar(new Map([['index.html', Buffer.alloc(40 * 1024 * 1024)]])),
    /exceeds/,
  );
});
test('forged binding and review signatures fail ordinary workspace reads even with fresh integrity', async (t) => {
  const { w, pid, a } = await setup(t);
  const s = structuredClone(a.payload.state);
  s.reviews.hero = { signature: 'a'.repeat(64), reason: 'forged' };
  const next = revise(a, { ...a.payload, state: s }, 'test', 'forged review');
  w.kernel.put(next);
  assert.throws(() => w.read(pid, reference(next)), /stale section review/);
});
test('closed root/copy restores comparison, reviews, accepted provenance and byte-identical handoff', async (t) => {
  const { root, w, c, pid, a, review, accept, reopen } = await setup(t);
  const current = await review();
  await accept();
  c.compare(pid, {
    compared: [reference(a), reference(current)],
    selected: reference(current),
    reason: 'Preserved exact comparison',
  });
  const before = await c.export(pid, reference(current));
  const reopened = reopen();
  assert.deepEqual(
    reopened.kernel.selected(pid, 'composition'),
    reference(current),
  );
  assert.equal(
    (await c.export(pid, reference(current))).checksum,
    before.checksum,
  );
  assert.ok(
    reopened
      .state(pid)
      .artifacts!.some(
        (a) => a.payload.kind === 'website-composition-comparison',
      ),
  );
  const copy = root + '-copy';
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  close(reopened);
  cpSync(root, copy, { recursive: true });
  const cloned = new Workspace(copy);
  try {
    assert.deepEqual(
      (await new Compositions(cloned).export(pid, reference(current))).bytes,
      before.bytes,
    );
  } finally {
    cloned.close();
  }
});

test('composition preserves locked intent, required content and palette with explicit rejection before persistence', async (t) => {
  const { w, pid, a, save } = await setup(t),
    count = w.kernel.ledger(pid).events.length;
  for (const change of [
    (c: typeof a.payload.state.content) => {
      c.sections[0]!.blocks[1]!.text = 'Different hidden objective';
    },
    (c: typeof a.payload.state.content) => {
      c.sections[1]!.blocks.find((b) => b.kind === 'list')!.items = [
        'Only one unrelated offer',
      ];
    },
    (c: typeof a.payload.state.content) => {
      c.style.background = '#ffffff';
    },
  ]) {
    const c = structuredClone(a.payload.state.content);
    change(c);
    await assert.rejects(() => save(c), /Locked/);
  }
  assert.equal(w.kernel.ledger(pid).events.length, count);
});
test('private reference originals and unknown asset pointers cannot be placed as approved composition files', async (t) => {
  const { w, pid, a, save } = await setup(t),
    c = structuredClone(a.payload.state.content),
    b = c.sections[0]!.blocks.find((b) => b.kind === 'image')!;
  b.asset = { id: 'missing-owned-file', version: 1, freshness: 'pinned' };
  await assert.rejects(() => save(c), /unknown/);
  const { syntheticCompositionImage } =
    await import('../scripts/composition-fixture.ts');
  const r = await w.addReference(
    pid,
    reference(w.project(pid)),
    await syntheticCompositionImage(),
    'Private original label excluded from handoff',
    'imagery',
    'hero',
  );
  const privateOriginal = r.artifacts!.find(
    (a) => a.payload.kind === 'website-reference',
  )!;
  b.asset = reference(privateOriginal);
  b.image = (privateOriginal.payload.state as { image: typeof b.image }).image;
  // Rebase context/direction for the save so the image boundary, not a stale brief, is exercised.
  const project = w.project(pid),
    round = w.explore(pid, {
      expectedProject: reference(project),
      count: 1,
      base: null,
    }),
    direction = (round.bundles!.at(-1)!.payload as { candidates: unknown[] })
      .candidates[0];
  await assert.rejects(
    () =>
      new Compositions(w).save(pid, {
        expectedProject: reference(project),
        expected: reference(a),
        direction,
        content: c,
        reason: 'Attempt to place a private original.',
      }),
    /owned image/,
  );
});
test('current-input guard rejects a concurrent brief revision during image decoding without an acceptance write', async (t) => {
  const { w, c, pid, review } = await setup(t),
    a = await review(),
    original = w.originalImage.bind(w);
  let changed = false;
  w.originalImage = async (...args) => {
    const result = await original(...args);
    if (!changed) {
      changed = true;
      w.reviseProject(pid, {
        expectedProject: reference(w.project(pid)),
        brief: { offer: 'Concurrent brief edit' },
        reason: 'Concurrent edit during asset validation.',
      });
    }
    return result;
  };
  const before = w.kernel
    .ledger(pid)
    .events.filter((e) => e.kind === 'acceptance').length;
  await assert.rejects(
    () =>
      c.accept(pid, {
        expectedProject: a.payload.state.project,
        artifact: reference(a),
        expected: null,
        reason: 'Stale asynchronous acceptance',
      }),
    /changed/,
  );
  assert.equal(w.kernel.selected(pid, 'composition'), null);
  assert.equal(
    w.kernel.ledger(pid).events.filter((e) => e.kind === 'acceptance').length,
    before,
  );
});
test('literal script-looking text is escaped in preview and handoff and cannot add executable markup', async (t) => {
  const { w, c, pid, save, review, accept } = await setup(t);
  const content = structuredClone(
    latestComposition(w, pid).payload.state.content,
  );
  content.sections[0]!.blocks[0]!.text = '<script>alert("x")</script>';
  await save(content);
  const a = await review();
  await accept();
  const html = await c.preview(pid, reference(a));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(
    !files((await c.export(pid, reference(a))).bytes)
      .get('index.html')!
      .toString()
      .includes('<script>'),
  );
});

test('global page contrast remains required when every section has readable overrides; invalid save preserves draft, acceptance and ledger', async (t) => {
  const { w, pid, save, review, accept } = await setup(t);
  let content = structuredClone(
    latestComposition(w, pid).payload.state.content,
  );
  for (const section of content.sections)
    section.overrides = {
      ...section.overrides,
      foreground: section.overrides.foreground ?? content.style.foreground,
      background: section.overrides.background ?? content.style.background,
    };
  await save(content);
  const accepted = await review();
  await accept();
  const events = w.kernel.ledger(pid).events.length;
  content = structuredClone(accepted.payload.state.content);
  content.style.foreground = content.style.background;
  await assert.rejects(() => save(content), /Global page text contrast/);
  assert.equal(latestComposition(w, pid).version, accepted.version);
  assert.equal(w.kernel.ledger(pid).events.length, events);
  assert.deepEqual(w.kernel.selected(pid, 'composition'), reference(accepted));
  assert.equal(
    canonical(w.read(pid, reference(accepted)).payload.state),
    canonical(accepted.payload.state),
  );
});
test('two distinct owned hero images survive immutable save, review, acceptance and pinned export', async (t) => {
  const { w, c, pid, fixture, a, save, review, accept } = await setup(t);
  const previous = canonical(a.payload.state),
    content = structuredClone(a.payload.state.content);
  const hero = content.sections.find((s) => s.id === 'hero')!,
    original = hero.blocks.find((b) => b.kind === 'image')!;
  const second = {
    ...original,
    id: 'hero-second-owned-image',
    asset: fixture.assets.replacement,
    image: (
      w.read(pid, fixture.assets.replacement).payload.state as {
        image: typeof original.image;
      }
    ).image,
    alt: 'Distinct second synthetic hero',
  };
  hero.blocks.push(second);
  await save(content);
  const accepted = await review();
  await accept();
  const handoff = await c.export(pid, reference(accepted)),
    manifest = JSON.parse(
      files(handoff.bytes).get('manifest.json')!.toString(),
    );
  const images = manifest.content.sections
    .find((s: { id: string }) => s.id === 'hero')
    .blocks.filter((b: { kind: string }) => b.kind === 'image');
  assert.equal(images.length, 2);
  assert.deepEqual(
    images.map((b: { asset: unknown }) => b.asset),
    [original.asset, second.asset],
  );
  assert.notEqual(images[0].image.checksum, images[1].image.checksum);
  assert.equal(manifest.assets.length, 5);
  for (const b of images)
    assert.ok(
      manifest.assets.some(
        (i: { checksum: string }) => i.checksum === b.image.checksum,
      ),
    );
  assert.equal(canonical(w.read(pid, reference(a)).payload.state), previous);
});
