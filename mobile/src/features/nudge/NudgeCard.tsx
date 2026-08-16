import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, fonts, radius, space } from '@/theme';
import type { Nudge } from './consequences';

/**
 * A pattern worth knowing about, and what it costs.
 *
 * Sits above the AI weekly report on Trends, deliberately: this is the
 * arithmetic, stated once and checkable, and the report below it is the
 * reflective read. Putting the derived numbers first means the prose is
 * commentary on something solid rather than the only account of the week.
 *
 * Styled as information, not alarm. Amber rather than red, no icon that looks
 * like a warning triangle — the user has not done anything wrong, and a screen
 * that tells people off is a screen they stop opening.
 */
export function NudgeCard({ nudge }: { nudge: Nudge }) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Feather name="trending-up" size={15} color={colors.warn} />
        <Text style={styles.title}>{nudge.title}</Text>
      </View>

      <Text style={styles.because}>{nudge.because}</Text>

      <View style={styles.rule} />

      <Text style={styles.label}>If the pattern holds</Text>
      <Text style={styles.body}>{nudge.ifRepeated}</Text>

      <Text style={[styles.label, styles.labelSpaced]}>What to do</Text>
      <Text style={styles.action}>{nudge.action}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.30)',
    borderRadius: radius,
    padding: space.lg,
    marginBottom: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.text, fontSize: 15.5, fontFamily: fonts.semibold, flexShrink: 1 },
  because: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: space.sm },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.md },
  label: {
    color: colors.warn,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: fonts.semibold,
  },
  labelSpaced: { marginTop: space.md },
  body: { color: colors.textDim, fontSize: 13.5, lineHeight: 19.5, marginTop: space.xs },
  action: { color: colors.text, fontSize: 13.5, lineHeight: 19.5, marginTop: space.xs },
});
