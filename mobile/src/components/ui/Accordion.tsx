import { ReactNode, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, fonts, radius, type } from '@/theme';

/**
 * A collapsible section.
 *
 * The Plan tab had grown into one long scroll of six cards, most of which a
 * person looks at once a week — the weigh-in history, the exercise log, the
 * step chart. Folding them away puts the answer to "am I on track?" on the
 * first screen and leaves the rest a tap away.
 *
 * `summary` is what the section says while closed, so collapsing hides the
 * detail without hiding the fact — a closed section still reports its number.
 */
interface AccordionProps {
  title: string;
  /** Shown on the right while collapsed: the one number this section is about. */
  summary?: string | null;
  /** Sections that answer the main question stay open; the rest fold away. */
  defaultOpen?: boolean;
  children: ReactNode;
}

// Android needs this switched on explicitly, and it throws if called on a
// platform that doesn't have it.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function Accordion({ title, summary, defaultOpen = false, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    // `easeInEaseOut` rather than a spring: this is a disclosure, not a
    // flourish, and a bouncing section under a finger reads as a mis-tap.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}`}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Text style={styles.title}>{title}</Text>
        <View style={styles.right}>
          {!open && summary ? <Text style={styles.summary}>{summary}</Text> : null}
          <Feather
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textDim}
          />
        </View>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  pressed: { backgroundColor: colors.surface2 },
  title: { ...type.subheading, color: colors.text, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  summary: { ...type.caption, color: colors.textDim, fontFamily: fonts.medium },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
  },
});
