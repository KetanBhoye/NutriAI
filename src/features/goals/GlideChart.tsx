import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import { Card } from '@/components/ui';
import { colors, fonts, statusColor, type } from '@/theme';
import { GlideWeek } from '@/types';

/**
 * Tuned for a phone: short enough to sit above the fold next to the other
 * cards, with the y-axis gutter kept narrow so the plot itself gets the width.
 */
const HEIGHT = 150;
const PAD_TOP = 10;
const PAD_BOTTOM = 8;
const PAD_LEFT = 34;
const PAD_RIGHT = 10;

interface GlideChartProps {
  weeks: GlideWeek[];
  /** Allowed drift either side of the plan line, in kg. */
  tolerance: number;
  /** Rendered width. The parent card is full-bleed, so this comes from onLayout. */
  width: number;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Planned weight (dashed) against actual weigh-ins (solid), with a shaded
 * tolerance band. Ported from the web app's GlideChart.vue — same x/y scaling,
 * drawn with react-native-svg instead of inline SVG.
 */
export function GlideChart({ weeks, tolerance, width }: GlideChartProps) {
  if (weeks.length < 2 || width <= 0) return null;

  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const targets = weeks.map((w) => w.target_kg);
  const actuals = weeks.filter((w) => w.actual_kg !== null).map((w) => w.actual_kg!);
  const lo = Math.min(...targets, ...actuals) - tolerance - 0.3;
  const hi = Math.max(...targets, ...actuals) + tolerance + 0.3;
  const span = hi - lo || 1;

  const x = (i: number) => PAD_LEFT + (i / (weeks.length - 1)) * plotW;
  const y = (kg: number) => PAD_TOP + (1 - (kg - lo) / span) * plotH;

  const targetPath = weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(w.target_kg)}`).join(' ');

  // The actual line only spans weeks that have a weigh-in, and must stop at
  // the last one rather than dropping to zero.
  const logged = weeks.map((w, i) => ({ w, i })).filter(({ w }) => w.actual_kg !== null);
  const actualPath = logged.map(({ w, i }, n) => `${n ? 'L' : 'M'}${x(i)},${y(w.actual_kg!)}`).join(' ');
  const latest = logged[logged.length - 1];

  const bandPoints = [
    ...weeks.map((w, i) => `${x(i)},${y(w.target_kg + tolerance)}`),
    ...weeks.map((w, i) => `${x(i)},${y(w.target_kg - tolerance)}`).reverse(),
  ].join(' ');

  const ticks = [hi, lo];

  // On a narrow screen only a few date labels fit without overlapping.
  const labelStep = Math.max(1, Math.ceil(weeks.length / 4));
  const xLabels = weeks
    .map((w, i) => ({ w, i }))
    .filter(({ i }) => i % labelStep === 0 || i === weeks.length - 1);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Planned vs actual</Text>
        {latest ? (
          <Text style={[styles.badge, { color: statusColor[latest.w.status] }]}>
            {latest.w.actual_kg!.toFixed(1)} kg
          </Text>
        ) : null}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={styles.swatchPlan} />
          <Text style={styles.legendText}>Planned</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.swatchActual} />
          <Text style={styles.legendText}>Actual</Text>
        </View>
      </View>

      {/* The tick overlay is positioned against this wrapper, not the card, so
          the topmost label can't ride up into the legend above. */}
      <View style={styles.plotWrap}>
        <Svg width={width} height={HEIGHT}>
          {ticks.map((kg, i) => (
            <Line
              key={`g${i}`}
              x1={PAD_LEFT}
              y1={y(kg)}
              x2={width - PAD_RIGHT}
              y2={y(kg)}
              stroke={colors.border}
              strokeWidth={1}
            />
          ))}

          <Polygon points={bandPoints} fill={colors.accent} fillOpacity={0.1} />

          <Path d={targetPath} stroke={colors.textDim} strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
          {actualPath ? <Path d={actualPath} stroke={colors.accent} strokeWidth={2.5} fill="none" /> : null}

          {logged.map(({ w, i }) => (
            <Circle key={w.week} cx={x(i)} cy={y(w.actual_kg!)} r={3.5} fill={statusColor[w.status]} />
          ))}
        </Svg>

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {ticks.map((kg, i) => (
            <Text key={`t${i}`} style={[styles.tick, { top: y(kg) - 7 }]}>
              {kg.toFixed(1)}
            </Text>
          ))}
        </View>
      </View>

      <View style={[styles.xAxis, { paddingLeft: PAD_LEFT, paddingRight: PAD_RIGHT }]}>
        {xLabels.map(({ w }) => (
          <Text key={w.week} style={styles.tickX}>
            {shortDate(w.date)}
          </Text>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingTop: 14, paddingBottom: 12, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
  },
  title: { ...type.subheading, color: colors.text },
  badge: { ...type.figureSmall, fontFamily: fonts.semibold, fontSize: 14 },
  legend: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, marginTop: 4, marginBottom: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatchPlan: { width: 12, height: 2, borderRadius: 1, backgroundColor: colors.textDim, opacity: 0.8 },
  swatchActual: { width: 12, height: 3, borderRadius: 2, backgroundColor: colors.accent },
  legendText: { ...type.caption, fontSize: 11.5, color: colors.textDim },
  plotWrap: { position: 'relative' },
  tick: { ...type.figureSmall, position: 'absolute', left: 8, fontSize: 10, color: colors.textDim },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tickX: { ...type.figureSmall, fontSize: 10, color: colors.textDim },
});
