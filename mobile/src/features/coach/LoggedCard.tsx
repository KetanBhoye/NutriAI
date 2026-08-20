import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { capitalize } from '@/format';
import { colors, fonts, radius, type } from '@/theme';
import { formatGrams } from '@/portion';
import { LoggedItem, LogDiff, diffHeadline } from './loggedItems';

/**
 * What the Coach just wrote to the log, itemised.
 *
 * The reply already says it in prose ("Logged your lunch — about 620 kcal"),
 * but prose is the model's account of what it did; this is the log's. When the
 * two disagree — a lookup that came back heavier than the user expected, an
 * item silently dropped — the card is the one telling the truth, and the user
 * can act on it without leaving the conversation.
 */

function macroLine(item: LoggedItem): string | null {
  const parts: string[] = [];
  if (item.protein_g != null) parts.push(`P ${Math.round(item.protein_g)}`);
  if (item.carbs_g != null) parts.push(`C ${Math.round(item.carbs_g)}`);
  if (item.fat_g != null) parts.push(`F ${Math.round(item.fat_g)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** "Lunch · 120 g", with either half omitted when the entry doesn't carry it. */
function contextLine(item: LoggedItem): string | null {
  const parts: string[] = [];
  if (item.meal_type) parts.push(capitalize(item.meal_type));
  if (item.quantity != null && item.unit === 'g' && item.quantity > 0) {
    parts.push(formatGrams(item.quantity));
  } else if (item.quantity != null && item.unit) {
    parts.push(`${item.quantity} ${item.unit}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

function Row({ item, kind }: { item: LoggedItem; kind: 'added' | 'updated' | 'removed' }) {
  const context = contextLine(item);
  const macros = macroLine(item);
  return (
    <View style={styles.row}>
      <Feather
        name={kind === 'removed' ? 'minus-circle' : kind === 'updated' ? 'edit-2' : 'check-circle'}
        size={14}
        color={kind === 'removed' ? colors.textDim : colors.accent}
        style={styles.rowIcon}
      />
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, kind === 'removed' && styles.rowNameRemoved]} numberOfLines={2}>
          {item.name}
        </Text>
        {context || macros ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {[context, macros].filter(Boolean).join('  ·  ')}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.rowKcal, kind === 'removed' && styles.rowNameRemoved]}>
        {kind === 'removed' ? '−' : ''}
        {Math.round(item.calories)}
      </Text>
    </View>
  );
}

export function LoggedCard({
  diff,
  dateLabel,
  onOpen,
}: {
  diff: LogDiff;
  /** "Today", "Yesterday" or a written date — whatever the thread is acting on. */
  dateLabel: string;
  onOpen: () => void;
}) {
  return (
    /* Shares its testID with the plain fallback line in coach.tsx: the E2E
       flow waits for "the coach wrote something", and which of the two shapes
       it got is not what that flow is about. */
    <View testID="coach-logged-card" style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Logged · {dateLabel}</Text>
        <Text style={styles.headline}>{diffHeadline(diff)}</Text>
      </View>

      <View style={styles.rows}>
        {diff.added.map((item) => (
          <Row key={`a-${item.id}`} item={item} kind="added" />
        ))}
        {diff.updated.map((item) => (
          <Row key={`u-${item.id}`} item={item} kind="updated" />
        ))}
        {diff.removed.map((item) => (
          <Row key={`r-${item.id}`} item={item} kind="removed" />
        ))}
      </View>

      {/* The day's running totals, so the card answers "and where does that
          leave me?" — the question every logged meal is really asking. */}
      <View style={styles.totals}>
        <Text style={styles.totalsLabel}>Day so far</Text>
        <Text style={styles.totalsValue}>
          {Math.round(diff.dayTotals.calories)} kcal · {Math.round(diff.dayTotals.protein_g)}g protein
        </Text>
      </View>

      <Pressable onPress={onOpen} style={({ pressed }) => [styles.open, pressed && styles.openPressed]}>
        <Text style={styles.openText}>Open {dateLabel.toLowerCase()}</Text>
        <Feather name="arrow-right" size={14} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.accentDim,
    borderRadius: radius,
    overflow: 'hidden',
  },
  head: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  eyebrow: { ...type.overline, color: colors.accent },
  headline: { ...type.subheading, color: colors.text, marginTop: 2 },
  rows: { borderTopWidth: 1, borderTopColor: colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIcon: { marginTop: 1 },
  rowBody: { flex: 1 },
  rowName: { ...type.body, fontSize: 14, color: colors.text },
  rowNameRemoved: { color: colors.textDim, textDecorationLine: 'line-through' },
  rowMeta: { ...type.caption, fontSize: 11.5, lineHeight: 15, color: colors.textDim, marginTop: 1 },
  rowKcal: { ...type.figureSmall, fontSize: 14, color: colors.text },
  totals: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  totalsLabel: { ...type.caption, fontSize: 12, color: colors.textDim },
  totalsValue: { ...type.figureSmall, fontSize: 12.5, color: colors.text },
  open: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: 'rgba(74,222,128,0.06)',
  },
  openPressed: { opacity: 0.7 },
  openText: { ...type.caption, fontFamily: fonts.semibold, color: colors.accent },
});
