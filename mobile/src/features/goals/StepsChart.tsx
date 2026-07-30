import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { addDays, toLocalISODate, todayISO } from '@/dates';
import { colors, type } from '@/theme';
import { DailyActivity } from '@/types';

const PLOT_HEIGHT = 96;
const DAYS = 14;

interface StepsChartProps {
  activity: DailyActivity[];
  /** Daily step target; drawn as a reference line and used for bar colour. */
  goal: number | null;
}

/**
 * Daily steps for the last two weeks. The Plan tab previously showed only a
 * 7-day average, which hides the day-to-day consistency this is meant to
 * surface.
 */
export function StepsChart({ activity, goal }: StepsChartProps) {
  const bySteps = new Map(activity.filter((a) => a.steps != null).map((a) => [a.activity_date, a.steps!]));

  const today = todayISO();
  const days = Array.from({ length: DAYS }, (_, n) => {
    const date = addDays(today, -(DAYS - 1 - n));
    return { date, steps: bySteps.get(date) ?? null };
  });

  const logged = days.filter((d) => d.steps !== null);
  const peak = Math.max(goal ?? 0, ...logged.map((d) => d.steps!), 1);
  const average = logged.length
    ? Math.round(logged.reduce((sum, d) => sum + d.steps!, 0) / logged.length)
    : null;

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.title}>Daily steps</Text>
        <Text style={styles.avg}>
          {average !== null ? `${average.toLocaleString()} avg` : 'No step data yet'}
        </Text>
      </View>

      <View style={styles.plot}>
        {goal ? <View style={[styles.goalLine, { bottom: (goal / peak) * PLOT_HEIGHT }]} /> : null}
        {days.map((d) => (
          <View key={d.date} style={styles.col}>
            <View
              style={[
                styles.bar,
                {
                  height: d.steps ? Math.max(3, (d.steps / peak) * PLOT_HEIGHT) : 2,
                  backgroundColor: !d.steps
                    ? colors.surface2
                    : goal && d.steps >= goal
                      ? colors.accent
                      : colors.accentDim,
                  opacity: d.steps ? 1 : 0.6,
                },
              ]}
            />
          </View>
        ))}
      </View>

      <View style={styles.labels}>
        <Text style={styles.label}>{days[0]!.date.slice(5)}</Text>
        {goal ? <Text style={styles.label}>goal {goal.toLocaleString()}</Text> : null}
        <Text style={styles.label}>today</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  title: { ...type.subheading, color: colors.text },
  avg: { ...type.figureSmall, color: colors.textDim },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: PLOT_HEIGHT },
  col: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 3 },
  goalLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: colors.textDim,
    borderStyle: 'dashed',
    opacity: 0.45,
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  label: { ...type.figureSmall, fontSize: 10, color: colors.textDim },
});
