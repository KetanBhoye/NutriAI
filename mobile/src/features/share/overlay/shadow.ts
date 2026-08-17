/**
 * The shadow every glyph in the overlay carries.
 *
 * The overlay has no panel behind it — that was the whole point of the redesign
 * — so nothing else separates white type from the photo underneath. A shadow on
 * each glyph is what keeps a number readable over a window, a white plate or a
 * gym mirror, and unlike a scrim it has no edges to give the sticker away as a
 * box.
 *
 * Kept deliberately tight. The first version used a 9px radius at 85% black,
 * which on a real Snap stopped reading as a shadow and started reading as a
 * grey plate behind every single number — the blur is drawn across the glyph's
 * whole bounding box, so at that radius the box is what you see, not the
 * letters. Small and soft separates type from a photo; large and dark just adds
 * furniture, which is what this design spent three attempts removing.
 *
 * Shared rather than repeated so the whole rail stays consistent: mismatched
 * shadows are the sort of thing that reads as "slightly wrong" without anyone
 * being able to say why.
 */
export const overlayShadow = {
  textShadowColor: 'rgba(0,0,0,0.5)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

/**
 * The opacity ladder for everything that is not a headline figure.
 *
 * Three passes to land here. The first values were too faint over a busy photo;
 * pushing them to ~0.9 fixed legibility and made the overlay shout — every
 * label competing with the numbers it was supposed to support. These sit in
 * between: present when you look at them, quiet when you look past them, which
 * is what a layer over someone else's picture should do.
 *
 * Only the two figures — steps and calories — are ever full strength.
 */
export const overlayOpacity = {
  /** Unit labels under a figure: STEPS, KCAL, DAY STREAK. */
  label: 0.78,
  /** Supporting lines: the date, "Goal 14,000", "97% of 1,750". */
  caption: 0.7,
  /** The brand lockup, quietest thing on the card. */
  brand: 0.62,
} as const;
