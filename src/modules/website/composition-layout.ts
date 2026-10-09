/** Additive handoff metadata. Values describe the shared renderer, not a second design store. */
export const rendererDefaults = {
  schema: 'bve.website-renderer-defaults',
  version: 2,
  units: 'CSS pixels unless stated otherwise',
  base: {
    boxSizing: 'border-box',
    bodyMargin: 0,
    lineHeight: 1.6,
    overflowWrap: 'anywhere',
    textWeight: 400,
    strongAndHeadingWeight: 700,
    smallSize: 14,
  },
  fonts: {
    system: 'system-ui,sans-serif',
    serif: 'Georgia,serif',
    rounded: 'Trebuchet MS,sans-serif',
  },
  header: {
    maxWidth: 'global maxWidth including padding',
    margin: 'auto',
    padding: 24,
    display: 'flex',
    gap: 24,
    justifyContent: 'space-between',
    alignItems: 'center',
    navGap: 20,
    navWrap: true,
  },
  section: {
    verticalPadding: 'effective spacing',
    horizontalPadding: 24,
    innerMaxWidth: 'effective maxWidth excluding section padding',
    innerMargin: 'auto',
    blockDisplay: 'grid',
    blockGap: 24,
    blockAlignItems: 'center',
  },
  heading: {
    margin: '0 0 24px',
    lineHeight: 1.12,
    letterSpacing: '-0.035em',
    h1Size: 'effective headingSize',
    h2Size: 'effective headingSize * 0.65',
  },
  paragraph: {
    maxWidth: '65ch',
    margin: '0 0 24px',
    centeredSideMargins: 'auto',
  },
  list: {
    defaultMargin: '1em 0',
    defaultPaddingLeft: 40,
    cardsColumns: 3,
    cardsGap: 16,
    cardsPadding: 0,
    cardsListStyle: 'none',
    cardBorder: '1px solid currentColor',
    cardPadding: 24,
    cardRadius: 'effective radius',
  },
  split: {
    columns: 'minmax(0,1.2fr) minmax(0,1fr)',
    imageColumn: 2,
    imageRowStart:
      '1 + 5 * zero-based image ordinal within section, including unresolved images',
    imageRowSpan: 5,
    otherBlocks:
      'CSS grid auto-placement in source order; implicit rows auto-sized; no DOM regrouping',
  },
  button: {
    display: 'inline-block',
    width: 'fit-content',
    padding: '12px 24px',
    weight: 700,
    decoration: 'none',
    centeredMargin: 'auto',
    colorsAndRadius: 'effective accent/actionText/radius',
  },
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
    maxHeight: 480,
    fitAndRadius: 'section fit / effective radius',
    intrinsicSize: 'pinned image width/height attributes',
  },
  missingImage: {
    border: '2px dashed currentColor',
    padding: 24,
    prefix: 'Unresolved image: ',
  },
  accessibilityException: { prefix: 'Accessibility exception: ', tag: 'small' },
  band: { borderTop: '1px solid currentColor' },
  footer: {
    padding: 24,
    textAlign: 'center',
    tag: 'small',
    text: 'Fictional service-business composition · synthetic content',
  },
  navigation: {
    anchorColor: 'inherit',
    decoration: 'browser default underline',
    labels: 'section id with first character uppercase, in section order',
    skipLabel: 'Skip to content',
    skipTarget: '#main',
    mainId: 'main',
    focusOutline: '3px solid currentColor',
    focusOutlineOffset: 5,
    skipPosition: 'absolute; left 16px; top -100px',
    focusedSkip: 'top 8px; z-index 10; global background; padding 12px',
  },
  narrow: {
    maxWidthInclusive: 760,
    headerDirection: 'column',
    headerAlignItems: 'flex-start',
    headerGap: 12,
    navGap: 14,
    sectionVerticalPadding: 'effective spacing * 0.65',
    sectionHorizontalPadding: 20,
    h1Size: 'clamp(32px,9vw,effective headingSize)',
    h2Size: 'clamp(26px,7vw,effective headingSize * 0.65)',
    splitColumns: 'minmax(0,1fr)',
    imageGridColumnAndRow: 'auto; source order',
    cardsColumns: 1,
    imageMaxHeight: 360,
  },
};

export const reconstructionInstructions = `# Reconstruct the accepted composition

Build a fresh static landing page using only manifest.json, assets/, and these instructions. Do not read or copy index.html during implementation: it is the comparison reference. No BVE source or runtime data is required. Verify the package SHA-256 before extraction; use safe relative paths, preserve original asset bytes, and verify each inventory checksum, size and dimensions.

The manifest pins ordered sections/blocks, global values, explicit overrides, direction, asset versions, provenance, acceptance and unresolved exceptions. Effective section style = global style overlaid by section overrides. Global style separately controls body, header, navigation, skip link and footer. Every image is bound to its own asset descriptor, including multiple images in one section; never replace it from an accepted-image pointer.

Implement rendererDefaults (schema bve.website-renderer-defaults, version 2) from the manifest. It documents all fixed layout/style values, fonts, browser list margins, tracking, weights, header bounds and gaps, band border, synthetic footer, keyboard focus and narrow rules. A max-width on the border-box header includes its padding; section inner max-width is inside section padding. Keep all blocks in source order. In split layouts each image gets its own five-row band starting at 1 + 5 * its zero-based image ordinal; other blocks use ordinary CSS grid auto-placement. At <=760px reset image grid row/column to auto. Stack and band use one grid column; cards only changes lists. This bounded recipe set has four sections and no generic canvas, CMS, publishing or booking backend.

Use literal escaped text, safe links and section anchors; no input scripts or HTML. Render one h1 in hero and h2 elsewhere, paragraphs, buttons as links, lists and images with pinned intrinsic dimensions and alt text. Preserve missing-image and accessibility exception messages and every unresolved item; acceptance and synthetic content do not grant brand approval. Include the documented skip link, section navigation and footer. The standalone reference uses a CSP that blocks scripts and remote resources. Serve through a local static HTTP server; direct file opening may restrict images.

Test at 1440 and 390 CSS pixels: text/order/links, global styles and overrides, original asset hashes, layout/spacing, distinct visible image geometry, overflow, contrast, keyboard skip/action/focus and unresolved exceptions. Record your model identity (do not invent an unavailable serving-model identifier), exact package hash, output files, any missing information and discrepancies. An independent AI reviewer then compares your fresh implementation with index.html at both widths. This is AI technical assessment; designer evaluation remains separate.
`;
