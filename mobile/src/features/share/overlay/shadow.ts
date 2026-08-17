/**
 * The shadow every glyph in the overlay carries.
 *
 * The overlay has no panel behind it — that was the whole point of the redesign
 * — so nothing else separates white type from the photo underneath. A shadow on
 * each glyph is what keeps a number readable over a window, a white plate or a
 * gym mirror, and unlike a scrim it has no edges to give the sticker away as a
 * box.
 *
 * Shared rather than repeated so the whole rail stays consistent: mismatched
 * shadows are the sort of thing that reads as "slightly wrong" without anyone
 * being able to say why.
 */
export const overlayShadow = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 9,
} as const;
