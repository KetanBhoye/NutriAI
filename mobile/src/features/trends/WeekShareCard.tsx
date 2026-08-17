import { StyleSheet, Text, View } from 'react-native';
import { BrandMark } from '@/components/BrandMark';
import { colors } from '@/theme';
import type { Consistency } from '@/api/dashboard';
import { ShareCardBackground } from '../today/ShareCardBackground';
import { themeFor, weekRangeLabel, weekShareCopy } from './weekShareCopy';

/**
 * The weekly story card.
 *
 * Rewritten after seeing it rendered next to the day card, which showed three
 * things a spec could not:
 *
 *  - They were the same object. Same warm gradient, same big-number-over-a-
 *    stat-grid layout. At thumbnail size nothing distinguished a week from a
 *    day. Week cards are now cool-palette only (see themeFor), and the trend
 *    is the hero rather than a footnote.
 *  - The stat labels collided — "DAYS LOGGED DAY STREAK" ran together, because
 *    three flexed columns had no gap and the labels were wider than their
 *    share. Now two columns with room, and short labels.
 *  - Zero-score weeks drew as 2px stubs that read as a rendering fault. A week
 *    with nothing logged is real data and now draws as a baseline dot, which
 *    says "nothing here" instead of "something broke".
 *
 * The division of labour with the day card: a day card is a *moment* — what
 * you ate, what you hit. A week card is a *trajectory* — the shape of eight
 * weeks. Neither repeats the other's stats.
 *
 * Laid out in points and snapshotted at 1080×1920, so every dimension derives
 * from `w`.
 */

interface Props {
  data: Consistency;
  stats: { streak: number; averageCalories: number };
  /** Card width in points. */
  w: number;
}

const ACCENTS: Record<string, string> = {
  'week-best': '#a78bfa',
  'week-strong': '#818cf8',
  'week-steady': '#60a5fa',
  'week-building': '#94a3b8',
};

export function WeekShareCard({ data, stats, w }: Props) {
  const h = Math.round((w * 16) / 9);
  const theme = themeFor(data);
  const accent = ACCENTS[theme] ?? colors.cyan;
  const copy = weekShareCopy(data);
  const pad = w * 0.085;

  // Scaled against at least 100 so a modest week is not drawn full height
  // merely because it was the best of the eight.
  const peak = Math.max(100, ...data.history.map((p) => p.score));
  const chartH = w * 0.42;

  return (
    <View style={{ width: w, height: h }}>
      <ShareCardBackground theme={theme} width={w} height={h} />

      <View style={[styles.body, { padding: pad }]}>
        <View style={styles.head}>
          <Text style={[styles.eyebrow, { fontSize: w * 0.034, color: accent }]}>
            {copy.eyebrow}
          </Text>
          <Text style={[styles.range, { fontSize: w * 0.032 }]}>
            {weekRangeLabel(data.week_start)}
          </Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { fontSize: w * 0.34, color: accent }]}>{data.score}</Text>
            <Text style={[styles.outOf, { fontSize: w * 0.055, marginBottom: w * 0.045 }]}>
              /100
            </Text>
          </View>
          <Text style={[styles.label, { fontSize: w * 0.036 }]}>CONSISTENCY SCORE</Text>
          <Text style={[styles.headline, { fontSize: w * 0.062 }]}>{copy.headline}</Text>
        </View>

        {/*
          The hero visual. A week card exists to show a direction, and this is
          the only element on either card that shows one — it is what makes the
          image legible as progress rather than a number someone typed.
        */}
        <View>
          <View style={[styles.chart, { height: chartH, gap: w * 0.016 }]}>
            {data.history.map((point, i) => {
              const current = i === data.history.length - 1;
              const empty = point.score === 0;
              return (
                <View key={point.weekStart} style={styles.col}>
                  {empty ? (
                    // A week with nothing logged: a baseline dot, not a stub.
                    <View
                      style={{
                        width: w * 0.018,
                        height: w * 0.018,
                        borderRadius: w * 0.009,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        width: '100%',
                        height: Math.max(w * 0.02, (point.score / peak) * chartH),
                        borderRadius: w * 0.012,
                        backgroundColor: current ? accent : 'rgba(255,255,255,0.16)',
                      }}
                    />
                  )}
                </View>
              );
            })}
          </View>
          <View style={[styles.axis, { marginTop: w * 0.028 }]}>
            <Text style={[styles.axisText, { fontSize: w * 0.028 }]}>8 WEEKS AGO</Text>
            <Text style={[styles.axisText, { fontSize: w * 0.028, color: accent }]}>THIS WEEK</Text>
          </View>
        </View>

        {/*
          Two stats, not three. Both are week-scale facts the day card never
          shows, and two columns leave the labels room to sit on one line.
        */}
        <View style={[styles.stats, { paddingTop: w * 0.045, gap: w * 0.06 }]}>
          <Stat w={w} value={`${data.days_logged}/7`} label="DAYS ON PLAN" />
          <Stat
            w={w}
            value={data.personal_best !== null ? String(Math.max(data.personal_best, data.score)) : String(data.score)}
            label="PERSONAL BEST"
          />
        </View>

        <View style={styles.footer}>
          <View style={styles.brand}>
            <BrandMark size={w * 0.07} />
            <Text style={[styles.brandText, { fontSize: w * 0.036 }]}>NutriAI</Text>
          </View>
          {data.comparison ? (
            <Text style={[styles.peer, { fontSize: w * 0.03 }]}>
              TOP {Math.max(1, 100 - data.comparison.better_than_percent)}%
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Stat({ w, value, label }: { w: number; value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.statValue, { fontSize: w * 0.068 }]}>{value}</Text>
      <Text style={[styles.statLabel, { fontSize: w * 0.028, marginTop: w * 0.01 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'space-between' },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  eyebrow: { fontWeight: '800', letterSpacing: 2.5 },
  range: { color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5 },

  hero: {},
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end' },
  score: { fontWeight: '800', letterSpacing: -3, includeFontPadding: false },
  outOf: { color: 'rgba(255,255,255,0.32)', fontWeight: '600', marginLeft: 4 },
  label: { color: 'rgba(255,255,255,0.45)', fontWeight: '700', letterSpacing: 2.5, marginTop: -2 },
  headline: { color: colors.text, fontWeight: '700', marginTop: 10, lineHeight: undefined },

  chart: { flexDirection: 'row', alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: 'rgba(255,255,255,0.3)', fontWeight: '700', letterSpacing: 1.4 },

  stats: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  statValue: { color: colors.text, fontWeight: '700' },
  statLabel: { color: 'rgba(255,255,255,0.4)', fontWeight: '600', letterSpacing: 1.2 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: 'rgba(255,255,255,0.6)', fontWeight: '700', letterSpacing: 0.3 },
  peer: { color: 'rgba(255,255,255,0.42)', fontWeight: '800', letterSpacing: 1.4 },
});
