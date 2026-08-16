import { StyleSheet, Text, View } from 'react-native';
import { BrandMark } from '@/components/BrandMark';
import { colors } from '@/theme';
import { DOWNLOAD_LABEL } from '@/config';
import type { Consistency } from '@/api/dashboard';
import { ShareCardBackground } from '../today/ShareCardBackground';
import { themeFor, weekRangeLabel, weekShareCopy } from './weekShareCopy';

/**
 * The weekly story card.
 *
 * Design brief was "rich but minimal — someone seeing it on a story should
 * wonder what app that is". What that actually means in a 9:16 frame someone
 * scrolls past in under a second:
 *
 *   - One thing is big. The score owns the card; everything else is support.
 *     Two competing focal points read as a dashboard, and nobody screenshots a
 *     dashboard.
 *   - Generous emptiness. The margins are wide and the stats sit in a single
 *     line near the bottom, so the card breathes instead of filling up.
 *   - One accent colour, taken from the week's own result, so a personal best
 *     and an ordinary week are visibly different objects in a feed.
 *   - The eight-week trend is the signature. It is the one element no other
 *     tracker's card has, and it is what makes the image legible as *progress*
 *     rather than a number someone typed.
 *   - Branding is small and bottom-aligned. A logo big enough to read at a
 *     glance turns the card into an advert, which is the fastest way to stop
 *     people posting it.
 *
 * Laid out in points and snapshotted at 1080×1920 by the modal, so everything
 * here is proportional to `w`.
 */

interface Props {
  data: Consistency;
  stats: { streak: number; averageCalories: number };
  /** Card width in points; every dimension derives from it. */
  w: number;
}

const ACCENTS: Record<string, string> = {
  perfect: '#f472b6',
  streak: '#fbbf24',
  dialed: colors.accent,
  steps: colors.cyan,
  default: colors.purple,
};

export function WeekShareCard({ data, stats, w }: Props) {
  const h = Math.round((w * 16) / 9);
  const theme = themeFor(data);
  const accent = ACCENTS[theme] ?? colors.accent;
  const copy = weekShareCopy(data);
  const pad = w * 0.1;

  // Trend bars. Scaled against at least 100 so a modest week is not drawn
  // full-height merely because it was the best of the eight.
  const peak = Math.max(100, ...data.history.map((p) => p.score));
  const trendH = w * 0.28;

  return (
    <View style={{ width: w, height: h }}>
      <ShareCardBackground theme={theme} width={w} height={h} />

      <View style={[styles.body, { padding: pad }]}>
        <View>
          <Text style={[styles.eyebrow, { fontSize: w * 0.038, color: accent }]}>
            {copy.eyebrow}
          </Text>
          <Text style={[styles.range, { fontSize: w * 0.036 }]}>
            {weekRangeLabel(data.week_start)}
          </Text>
        </View>

        {/* The hero. Nothing else on the card competes with it. */}
        <View style={styles.hero}>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { fontSize: w * 0.42, color: accent }]}>{data.score}</Text>
            <Text style={[styles.outOf, { fontSize: w * 0.075, marginBottom: w * 0.06 }]}>/100</Text>
          </View>
          <Text style={[styles.label, { fontSize: w * 0.042 }]}>CONSISTENCY</Text>
          <Text style={[styles.headline, { fontSize: w * 0.078 }]}>{copy.headline}</Text>
        </View>

        {/* The signature element: eight weeks at a glance. */}
        <View style={{ height: trendH, flexDirection: 'row', alignItems: 'flex-end', gap: w * 0.014 }}>
          {data.history.map((point, i) => {
            const current = i === data.history.length - 1;
            return (
              <View
                key={point.weekStart}
                style={{
                  flex: 1,
                  height: Math.max(w * 0.008, (point.score / peak) * trendH),
                  borderRadius: w * 0.008,
                  backgroundColor: current ? accent : 'rgba(255,255,255,0.16)',
                }}
              />
            );
          })}
        </View>
        <Text style={[styles.trendLabel, { fontSize: w * 0.032, marginTop: w * 0.025 }]}>
          8 WEEKS
        </Text>

        <View style={[styles.stats, { marginTop: w * 0.07, paddingTop: w * 0.055 }]}>
          <Stat w={w} value={`${data.days_logged}/7`} label="DAYS LOGGED" />
          <Stat w={w} value={String(stats.streak)} label="DAY STREAK" />
          <Stat w={w} value={stats.averageCalories ? String(stats.averageCalories) : '—'} label="AVG KCAL" />
        </View>

        <View style={styles.footer}>
          <View style={styles.brand}>
            <BrandMark size={w * 0.075} />
            <View>
              <Text style={[styles.brandText, { fontSize: w * 0.038 }]}>NutriAI</Text>
              {/* The install link lives on the image itself rather than in a
                  swipe-up attachment: it survives a screenshot, a re-share and
                  a repost, which is how these actually travel. */}
              <Text style={[styles.link, { fontSize: w * 0.026 }]}>{DOWNLOAD_LABEL}</Text>
            </View>
          </View>
          {/* Smallest line on the card, and only when the server sent one. */}
          {data.comparison ? (
            <Text style={[styles.peer, { fontSize: w * 0.032 }]}>
              Top {Math.max(1, 100 - data.comparison.better_than_percent)}%
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
      <Text style={[styles.statValue, { fontSize: w * 0.072 }]}>{value}</Text>
      <Text style={[styles.statLabel, { fontSize: w * 0.03, marginTop: w * 0.012 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'space-between' },
  eyebrow: { fontWeight: '800', letterSpacing: 2 },
  range: { color: 'rgba(255,255,255,0.45)', marginTop: 4, letterSpacing: 0.5 },

  hero: { marginTop: 'auto' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end' },
  score: { fontWeight: '800', letterSpacing: -3, includeFontPadding: false },
  outOf: { color: 'rgba(255,255,255,0.35)', fontWeight: '600', marginLeft: 4 },
  label: { color: 'rgba(255,255,255,0.5)', fontWeight: '700', letterSpacing: 3, marginTop: -4 },
  headline: { color: colors.text, fontWeight: '700', marginTop: 10 },

  trendLabel: { color: 'rgba(255,255,255,0.3)', fontWeight: '700', letterSpacing: 2 },

  stats: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  statValue: { color: colors.text, fontWeight: '700' },
  statLabel: { color: 'rgba(255,255,255,0.4)', fontWeight: '600', letterSpacing: 1.2 },

  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: 'rgba(255,255,255,0.65)', fontWeight: '700', letterSpacing: 0.3 },
  link: { color: 'rgba(255,255,255,0.35)', letterSpacing: 0.2, marginTop: 1 },
  peer: { color: 'rgba(255,255,255,0.4)', fontWeight: '600', letterSpacing: 0.6 },
});
