import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BrandMark } from '@/components/BrandMark';
import { colors, fonts } from '@/theme';

/**
 * The panel a sticker sits in.
 *
 * A sticker is a different design problem from a share card, and the difference
 * is the background: a card owns the whole frame and can put its type straight
 * onto a gradient it chose, while a sticker lands on a photo the user picked
 * seconds earlier — a plate under a window, a dim gym, a white wall. Type alone
 * does not survive that. Neither does a translucent panel: there is no backdrop
 * blur in a flat PNG, so anything see-through inherits whatever is behind it and
 * turns to mud over a busy shot.
 *
 * So the panel is near-opaque and dark, and everything else follows from
 * carrying its own ground:
 *
 *  - **A hairline of light around the edge.** Over a dark photo the panel would
 *    otherwise dissolve into it; the border is what keeps it an object.
 *  - **A drop shadow.** The one cue that says "on top of" rather than "part
 *    of", and the thing that stops it reading as a bad crop.
 *  - **Generous corner radius.** Snapchat's own stickers are soft-cornered;
 *    sharp corners read as a screenshot someone pasted in.
 *
 * Sized from `w` like the cards, but `w` here is the *sticker* width — roughly
 * three quarters of the screen, not the whole 9:16 frame. The composition is
 * deliberately short: it is competing with the user's photo, and a tall panel
 * covers the thing they wanted to show.
 */

interface Props {
  /** Sticker width in points. Everything scales from this. */
  w: number;
  /** Colour for the hero figure and the eyebrow. */
  accent: string;
  eyebrow: string;
  /** Small right-aligned text on the eyebrow row — a date or week range. */
  meta: string;
  children: ReactNode;
  /** Optional right-hand footer note, e.g. "TOP 12%". */
  note?: string | null;
}

export function StickerFrame({ w, accent, eyebrow, meta, children, note }: Props) {
  const pad = w * 0.075;

  return (
    /**
     * The outer view stays transparent on purpose — react-native-view-shot
     * captures exactly what is here, so any background colour on this wrapper
     * would be baked into the PNG and the sticker would ship with a black box
     * around it.
     */
    <View style={{ width: w, paddingVertical: w * 0.05, paddingHorizontal: w * 0.05 }}>
      <View
        style={[
          styles.panel,
          {
            borderRadius: w * 0.085,
            padding: pad,
            shadowRadius: w * 0.05,
            shadowOffset: { width: 0, height: w * 0.015 },
          },
        ]}
      >
        <View style={styles.head}>
          <Text style={[styles.eyebrow, { fontSize: w * 0.042, color: accent }]}>{eyebrow}</Text>
          <Text style={[styles.meta, { fontSize: w * 0.04 }]}>{meta}</Text>
        </View>

        {children}

        <View style={[styles.footer, { marginTop: w * 0.06, paddingTop: w * 0.045 }]}>
          <View style={styles.brand}>
            <BrandMark size={w * 0.075} />
            <Text style={[styles.brandText, { fontSize: w * 0.042 }]}>NutriAI</Text>
          </View>
          {note ? <Text style={[styles.note, { fontSize: w * 0.038 }]}>{note}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    // Not fully opaque, but close: enough to let a hint of the photo through at
    // the edges without ever putting text on top of it.
    backgroundColor: 'rgba(9,12,17,0.94)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    // Android ignores shadow* and needs elevation; both are set so the sticker
    // looks the same in the on-screen preview as it does in the captured PNG.
    elevation: 12,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  eyebrow: { fontFamily: fonts.bold, letterSpacing: 2 },
  meta: { color: 'rgba(255,255,255,0.42)', fontFamily: fonts.semibold, letterSpacing: 0.4 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandText: { color: 'rgba(255,255,255,0.62)', fontFamily: fonts.bold, letterSpacing: 0.3 },
  note: { color: 'rgba(255,255,255,0.45)', fontFamily: fonts.bold, letterSpacing: 1.3 },
});

export const stickerStyles = StyleSheet.create({
  // An explicit colour, because the default is the platform's — black on
  // Android, which on this panel means an invisible number. Callers that want
  // the accent override it; the ones that do not must still be readable.
  figure: {
    color: colors.text,
    fontFamily: fonts.bold,
    letterSpacing: -2,
    includeFontPadding: false,
  },
  unit: { color: 'rgba(255,255,255,0.34)', fontFamily: fonts.semibold },
  caption: { color: colors.text, fontFamily: fonts.semibold },
});
