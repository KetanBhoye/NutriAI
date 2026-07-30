import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import { Card } from '@/components/ui';
import { parseISODate, todayISO } from '@/dates';
import { colors, fonts, statusColor, type } from '@/theme';
import { GoalPlan, PlanProgress, WeighIn } from '@/types';

/** Matches GlideChart's proportions so the two cards sit together. */
const HEIGHT = 170;
const PAD_TOP = 10;
const PAD_BOTTOM = 8;
const PAD_LEFT = 34;
const PAD_RIGHT = 10;
/** Window for the smoothed line — the same span the server fits the trend over. */
const SMOOTH_DAYS = 7;

interface WeightTrendChartProps {
  plan: GoalPlan;
  /** Every weigh-in in the plan window, daily. */
  weighIns: WeighIn[];
  progress?: PlanProgress | null;
  /** Rendered width. The parent card is full-bleed, so this comes from onLayout. */
  width: number;
}

function dayOffset(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Every reading averaged with the week before it. A daily weight swings up to
 * a kilo on salt, sleep and time of day, so the raw dots alone say nothing
 * about whether the plan is working — the smoothed line is what you read.
 */
function smooth(points: Array<{ day: number; kg: number }>): Array<{ day: number; kg: number }> {
  return points.map((p, i) => {
    const window = points.slice(0, i + 1).filter((q) => p.day - q.day < SMOOTH_DAYS);
    return { day: p.day, kg: window.reduce((s, q) => s + q.kg, 0) / window.length };
  });
}

/**
 * Daily weigh-ins against the plan's baseline.
 *
 * The glide path answered "was that *week* on target". This is the day-by-day
 * picture: raw weigh-ins, the smoothed trend through them, the plan's line with
 * its tolerance band, and — once there's enough data to fit a rate — where that
 * trend lands on the target date.
 */
export function WeightTrendChart({ plan, weighIns, progress, width }: WeightTrendChartProps) {
  if (width <= 0 || weighIns.length === 0) return null;

  const today = todayISO();
  const totalDays = Math.max(1, dayOffset(plan.start_date, plan.target_date));

  const points = weighIns
    .map((w) => ({ day: dayOffset(plan.start_date, w.recorded_date), kg: w.weight_kg }))
    .filter((p) => p.day >= 0)
    .sort((a, b) => a.day - b.day);
  if (points.length === 0) return null;

  const trend = smooth(points);
  const todayDay = Math.min(Math.max(dayOffset(plan.start_date, today), 0), totalDays);

  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const weights = points.map((p) => p.kg);
  const projected = progress?.projected_kg_at_target ?? null;
  const lo =
    Math.min(...weights, plan.goal_weight_kg, plan.start_weight_kg, projected ?? Infinity) -
    plan.tolerance_kg -
    0.3;
  const hi =
    Math.max(...weights, plan.goal_weight_kg, plan.start_weight_kg, projected ?? -Infinity) +
    plan.tolerance_kg +
    0.3;
  const span = hi - lo || 1;

  const x = (day: number) => PAD_LEFT + (day / totalDays) * plotW;
  const y = (kg: number) => PAD_TOP + (1 - (kg - lo) / span) * plotH;

  const baselinePath = `M${x(0)},${y(plan.start_weight_kg)} L${x(totalDays)},${y(plan.goal_weight_kg)}`;
  const bandPoints = [
    `${x(0)},${y(plan.start_weight_kg + plan.tolerance_kg)}`,
    `${x(totalDays)},${y(plan.goal_weight_kg + plan.tolerance_kg)}`,
    `${x(totalDays)},${y(plan.goal_weight_kg - plan.tolerance_kg)}`,
    `${x(0)},${y(plan.start_weight_kg - plan.tolerance_kg)}`,
  ].join(' ');

  const trendPath = trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.kg)}`).join(' ');

  // Where the measured rate lands on the target date, drawn from the last
  // smoothed point so it reads as a continuation rather than a second series.
  const last = trend[trend.length - 1]!;
  const flag = progress?.status ?? 'empty';
  const projectionPath =
    projected !== null && last.day < totalDays
      ? `M${x(last.day)},${y(last.kg)} L${x(totalDays)},${y(projected)}`
      : null;

  const ticks = [hi, lo];
  const labelDays = [0, Math.round(totalDays / 2), totalDays];

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Daily weight vs plan</Text>
        {progress?.actual_kg != null ? (
          <Text style={[styles.badge, { color: statusColor[flag] }]}>
            {progress.actual_kg.toFixed(1)} kg
          </Text>
        ) : null}
      </View>

      <View style={styles.legend}>
        <LegendItem swatch={styles.swatchPlan} label="Plan" />
        <LegendItem swatch={styles.swatchTrend} label={`${SMOOTH_DAYS}-day trend`} />
        <LegendItem swatch={styles.swatchDot} label="Weigh-in" />
        {projectionPath ? (
          <LegendItem swatch={[styles.swatchProjection, { backgroundColor: statusColor[flag] }]} label="Projected" />
        ) : null}
      </View>

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
          <Path d={baselinePath} stroke={colors.textDim} strokeWidth={1.5} strokeDasharray="4 4" fill="none" />

          {/* Today, so "behind" is read against the right point on the line. */}
          <Line
            x1={x(todayDay)}
            y1={PAD_TOP}
            x2={x(todayDay)}
            y2={HEIGHT - PAD_BOTTOM}
            stroke={colors.border}
            strokeWidth={1}
            strokeDasharray="2 4"
          />

          {projectionPath ? (
            <Path
              d={projectionPath}
              stroke={statusColor[flag]}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              fill="none"
            />
          ) : null}

          {points.map((p) => (
            <Circle key={`r${p.day}`} cx={x(p.day)} cy={y(p.kg)} r={1.8} fill={colors.textDim} />
          ))}
          {trendPath ? <Path d={trendPath} stroke={colors.accent} strokeWidth={2.5} fill="none" /> : null}
          <Circle cx={x(last.day)} cy={y(last.kg)} r={3.5} fill={statusColor[flag]} />
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
        {labelDays.map((day) => (
          <Text key={day} style={styles.tickX}>
            {shortDate(isoFor(plan.start_date, day))}
          </Text>
        ))}
      </View>

      {progress?.baseline_kg != null && progress.actual_kg != null ? (
        <Text style={styles.footnote}>
          Today's plan weight is {progress.baseline_kg.toFixed(1)} kg; the trend says{' '}
          {progress.actual_kg.toFixed(1)} kg
          {progress.readings_used > 1 ? ` (${progress.readings_used} readings)` : ''}.
        </Text>
      ) : null}
    </Card>
  );
}

function isoFor(start: string, day: number): string {
  const d = parseISODate(start);
  d.setDate(d.getDate() + day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function LegendItem({ swatch, label }: { swatch: StyleProp<ViewStyle>; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={swatch} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingTop: 14, paddingBottom: 12, overflow: 'hidden' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16 },
  title: { ...type.subheading, color: colors.text },
  badge: { ...type.figureSmall, fontFamily: fonts.semibold, fontSize: 14 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, marginTop: 4, marginBottom: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { ...type.caption, fontSize: 11.5, color: colors.textDim },
  swatchPlan: { width: 12, height: 2, borderRadius: 1, backgroundColor: colors.textDim, opacity: 0.8 },
  swatchTrend: { width: 12, height: 3, borderRadius: 2, backgroundColor: colors.accent },
  swatchDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.textDim },
  swatchProjection: { width: 12, height: 2, borderRadius: 1 },
  plotWrap: { position: 'relative' },
  tick: { ...type.figureSmall, position: 'absolute', left: 8, fontSize: 10, color: colors.textDim },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tickX: { ...type.figureSmall, fontSize: 10, color: colors.textDim },
  footnote: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 16, marginTop: 8 },
});
