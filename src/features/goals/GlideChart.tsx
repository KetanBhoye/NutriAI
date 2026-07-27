import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import { Card } from '@/components/ui';
import { colors, statusColor, type } from '@/theme';
import { GlideWeek } from '@/types';

const HEIGHT = 190;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PAD_LEFT = 38;
const PAD_RIGHT = 12;

interface GlideChartProps {
  weeks: GlideWeek[];
  /** Allowed drift either side of the plan line, in kg. */
  tolerance: number;
  /** Rendered width. The parent card is full-bleed, so this comes from onLayout. */
  width: number;
}

/**
 * Planned weight (dashed) against actual weigh-ins (solid), with a shaded
 * tolerance band. Ported from the web app's GlideChart.vue — the x/y scaling
 * is the same, drawn with react-native-svg instead of inline SVG.
 */
export function GlideChart({ weeks, tolerance, width }: GlideChartProps) {
  if (weeks.length < 2 || width <= 0) return null;

  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const targets = weeks.map((w) => w.target_kg);
  const actuals = weeks.filter((w) => w.actual_kg !== null).map((w) => w.actual_kg!);
  const lo = Math.min(...targets, ...actuals) - tolerance - 0.4;
  const hi = Math.max(...targets, ...actuals) + tolerance + 0.4;
  const span = hi - lo || 1;

  const x = (i: number) => PAD_LEFT + (i / (weeks.length - 1)) * plotW;
  const y = (kg: number) => PAD_TOP + (1 - (kg - lo) / span) * plotH;

  const targetPath = weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(w.target_kg)}`).join(' ');

  // The actual line only spans the weeks that have a weigh-in, and must stop
  // at the last one rather than dropping to zero.
  const logged = weeks.map((w, i) => ({ w, i })).filter(({ w }) => w.actual_kg !== null);
  const actualPath = logged.map(({ w, i }, n) => `${n ? 'L' : 'M'}${x(i)},${y(w.actual_kg!)}`).join(' ');

  const bandPoints = [
    ...weeks.map((w, i) => `${x(i)},${y(w.target_kg + tolerance)}`),
    ...weeks.map((w, i) => `${x(i)},${y(w.target_kg - tolerance)}`).reverse(),
  ].join(' ');

  const ticks = [hi, (hi + lo) / 2, lo];

  return (
    <Card style={styles.card}>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, styles.swatchPlan]} />
          <Text style={styles.legendText}>Planned</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
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

          <Polygon points={bandPoints} fill={colors.accent} fillOpacity={0.08} />

          <Path d={targetPath} stroke={colors.textDim} strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
          {actualPath ? <Path d={actualPath} stroke={colors.accent} strokeWidth={2.5} fill="none" /> : null}

          {logged.map(({ w, i }) => (
            <Circle key={w.week} cx={x(i)} cy={y(w.actual_kg!)} r={4} fill={statusColor[w.status]} />
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

      <View style={styles.xAxis}>
        <Text style={styles.tickX}>{weeks[0]!.date.slice(5)}</Text>
        <Text style={styles.tickX}>{weeks[weeks.length - 1]!.date.slice(5)}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingTop: 14, paddingBottom: 10, overflow: 'hidden' },
  legend: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, marginBottom: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 3, borderRadius: 2 },
  swatchPlan: { backgroundColor: colors.textDim, opacity: 0.7 },
  legendText: { ...type.caption, color: colors.textDim },
  plotWrap: { position: 'relative' },
  tick: { ...type.figureSmall, position: 'absolute', left: 8, fontSize: 10, color: colors.textDim },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, marginTop: -14 },
  tickX: { ...type.figureSmall, fontSize: 10, color: colors.textDim },
});
