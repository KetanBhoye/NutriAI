import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { colors, radius, space } from '@/theme';
import type { Consistency } from '@/api/dashboard';

/**
 * The consistency score, at the top of Trends.
 *
 * Layout follows the priority the design is built on:
 *   1. the number, and what it means for *you* this week
 *   2. your own eight-week trend — the comparison that always applies
 *   3. what moved it (the components)
 *   4. and only last, and only sometimes, other people
 *
 * The peer line is a footnote by construction. It is the smallest text on the
 * card and the last thing read, because a score you are chasing against
 * strangers stops being about your own habit. The server omits it entirely
 * when it would discourage, so there is no "hide it" branch here to get wrong.
 */

const BAND_COLOR: Record<Consistency['headline']['band'], string> = {
  excellent: colors.accent,
  strong: colors.accent,
  steady: colors.cyan,
  building: colors.warn,
};

const BAR_HEIGHT = 34;

export function ConsistencyCard({
  data,
  onShare,
}: {
  data: Consistency;
  /** Absent when the week is not worth offering as a story — see weekShareCopy. */
  onShare?: () => void;
}) {
  const accent = BAND_COLOR[data.headline.band];
  const peak = Math.max(100, ...data.history.map((h) => h.score));

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>CONSISTENCY</Text>
        <View style={styles.headRight}>
          {data.is_personal_best && data.score > 0 ? (
            <View style={styles.bestPill}>
              <Text style={styles.bestPillText}>PERSONAL BEST</Text>
            </View>
          ) : null}
          {/* Offered only for a week worth showing other people. A share
              button on a bad week is an invitation to broadcast a bad week. */}
          {onShare ? (
            <Pressable onPress={onShare} hitSlop={10} accessibilityLabel="Share your week">
              <Text style={styles.share}>Share</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color: accent }]}>{data.score}</Text>
        <Text style={styles.outOf}>/ 100</Text>
      </View>

      <Text style={styles.title}>{data.headline.title}</Text>
      <Text style={styles.detail}>{data.headline.detail}</Text>

      {/* Your own trend: the comparison that is always fair, always available,
          and the only one that reflects a decision the user actually made. */}
      <View style={styles.spark} accessibilityLabel="Consistency over the last eight weeks">
        {data.history.map((week, i) => {
          const isCurrent = i === data.history.length - 1;
          return (
            <View
              key={week.weekStart}
              style={[
                styles.sparkBar,
                {
                  height: Math.max(2, (week.score / peak) * BAR_HEIGHT),
                  backgroundColor: isCurrent ? accent : colors.surface2,
                },
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.sparkLabel}>Last 8 weeks</Text>

      <View style={styles.components}>
        <Component label="Logging" value={data.components.logging} />
        <Component label="Calories" value={data.components.calories} />
        <Component label="Protein" value={data.components.protein} />
        <Component label="Movement" value={data.components.movement} />
      </View>

      {data.comparison ? (
        <Text style={styles.peer}>
          More consistent than {data.comparison.better_than_percent}% of members this week
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * A null value means the user has no goal for that component, so it was not
 * scored. Showing "0%" there would read as a failure at something they were
 * never asked to do.
 */
function Component({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={styles.component}>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${value ?? 0}%`,
              backgroundColor: value === null ? colors.border : colors.accentDim,
            },
          ]}
        />
      </View>
      <Text style={styles.componentLabel}>{label}</Text>
      <Text style={[styles.componentValue, value === null && styles.componentMuted]}>
        {value === null ? 'Not tracked' : `${value}%`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space.lg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  share: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  eyebrow: { color: colors.textDim, fontSize: 11, letterSpacing: 1.2, fontWeight: '700' },
  bestPill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  bestPillText: { color: colors.onAccent, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.sm },
  score: { fontSize: 46, fontWeight: '800', lineHeight: 50 },
  outOf: { color: colors.textDim, fontSize: 15, marginLeft: 6, marginBottom: 8 },

  title: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: space.xs },
  detail: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 2 },

  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: BAR_HEIGHT,
    marginTop: space.md,
  },
  sparkBar: { flex: 1, borderRadius: 2 },
  sparkLabel: { color: colors.textDim, fontSize: 10, marginTop: space.xs, letterSpacing: 0.4 },

  components: { marginTop: space.md, gap: space.sm },
  component: { gap: 4 },
  track: { height: 5, backgroundColor: colors.surface2, borderRadius: radius, overflow: 'hidden' },
  fill: { height: 5, borderRadius: radius },
  componentLabel: { color: colors.textDim, fontSize: 11, position: 'absolute', left: 0, top: 9 },
  componentValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
    marginTop: 9,
  },
  componentMuted: { color: colors.textDim, fontWeight: '400' },

  peer: {
    color: colors.textDim,
    fontSize: 11,
    marginTop: space.md,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
