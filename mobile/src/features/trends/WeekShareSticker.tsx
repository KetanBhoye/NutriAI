import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import type { Consistency } from '@/api/dashboard';
import { StickerFrame, stickerStyles } from '../share/StickerFrame';
import { themeFor, weekRangeLabel } from './weekShareCopy';

/**
 * The week, as a sticker.
 *
 * Keeps the division of labour the two cards already have: a day is a moment,
 * a week is a trajectory. So the day sticker leads with a number against a
 * goal, and this one leads with the score *and the shape of the weeks behind
 * it* — the sparkline is not decoration here, it is the entire reason a week is
 * worth posting at all.
 *
 * Shorter than the card's chart on purpose. At sticker size the eight bars are
 * a texture rather than a readable series: you see rising, flat or falling, and
 * that is all anyone gets from a Story anyway. Trying to keep it readable as a
 * chart would mean a taller panel, which means covering more of the photo.
 */

const ACCENTS: Record<string, string> = {
  'week-best': '#a78bfa',
  'week-strong': '#818cf8',
  'week-steady': '#60a5fa',
  'week-building': '#94a3b8',
};

interface Props {
  data: Consistency;
  /** Sticker width in points. */
  w: number;
}

export function WeekShareSticker({ data, w }: Props) {
  const accent = ACCENTS[themeFor(data)] ?? colors.cyan;
  // Same floor as the card: a modest week must not draw full height merely
  // because it was the best of the eight.
  const peak = Math.max(100, ...data.history.map((p) => p.score));
  const chartH = w * 0.17;

  return (
    <StickerFrame
      w={w}
      accent={accent}
      eyebrow="THIS WEEK"
      meta={weekRangeLabel(data.week_start)}
      note={
        data.comparison
          ? `TOP ${Math.max(1, 100 - data.comparison.better_than_percent)}%`
          : null
      }
    >
      <View style={[styles.figureRow, { marginTop: w * 0.045 }]}>
        <Text style={[stickerStyles.figure, { fontSize: w * 0.2, color: accent }]}>
          {data.score}
        </Text>
        <Text style={[stickerStyles.unit, { fontSize: w * 0.05, marginBottom: w * 0.025 }]}>
          {' / 100'}
        </Text>
      </View>
      <Text style={[styles.label, { fontSize: w * 0.036 }]}>CONSISTENCY</Text>

      <View style={[styles.chart, { height: chartH, gap: w * 0.014, marginTop: w * 0.055 }]}>
        {data.history.map((point, i) => {
          const current = i === data.history.length - 1;
          return (
            <View key={point.weekStart} style={styles.col}>
              {point.score === 0 ? (
                // A week with nothing logged is real data: a baseline dot says
                // "nothing here", a 2px stub reads as a rendering fault.
                <View
                  style={{
                    width: w * 0.02,
                    height: w * 0.02,
                    borderRadius: w * 0.01,
                    backgroundColor: 'rgba(255,255,255,0.22)',
                  }}
                />
              ) : (
                <View
                  style={{
                    width: '100%',
                    height: Math.max(w * 0.022, (point.score / peak) * chartH),
                    borderRadius: w * 0.012,
                    backgroundColor: current ? accent : 'rgba(255,255,255,0.18)',
                  }}
                />
              )}
            </View>
          );
        })}
      </View>

      <View style={[styles.stats, { marginTop: w * 0.05, gap: w * 0.05 }]}>
        <Stat w={w} value={`${data.days_logged}/7`} label="DAYS ON PLAN" />
        <Stat
          w={w}
          value={String(
            data.personal_best !== null
              ? Math.max(data.personal_best, data.score)
              : data.score
          )}
          label="PERSONAL BEST"
        />
      </View>
    </StickerFrame>
  );
}

function Stat({ w, value, label }: { w: number; value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.statValue, { fontSize: w * 0.055 }]}>{value}</Text>
      <Text style={[styles.statLabel, { fontSize: w * 0.03, marginTop: w * 0.008 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  figureRow: { flexDirection: 'row', alignItems: 'flex-end' },
  label: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: fonts.bold,
    letterSpacing: 2,
    marginTop: -2,
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  stats: { flexDirection: 'row' },
  statValue: { color: colors.text, fontFamily: fonts.bold },
  statLabel: { color: 'rgba(255,255,255,0.4)', fontFamily: fonts.semibold, letterSpacing: 1.1 },
});
