import { StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { colors, fonts, statusColor, type } from '@/theme';
import { PlanProgress } from '@/types';

const LABEL: Record<PlanProgress['status'], string> = {
  ahead: 'AHEAD OF PLAN',
  on: 'ON PLAN',
  watch: 'DRIFTING',
  behind: 'BEHIND PLAN',
  empty: 'NO RECENT WEIGH-IN',
};

interface ProgressFlagProps {
  progress: PlanProgress;
  /** Current daily calorie target, so the suggestion can show the new figure. */
  calorieGoal: number | null;
  /** Applies the suggested adjustment to the calorie target. */
  onApply: (newCalorieGoal: number) => void;
  applying?: boolean;
}

function rate(kgPerWeek: number | null): string {
  if (kgPerWeek === null) return '—';
  const sign = kgPerWeek > 0 ? '+' : '−';
  return `${sign}${Math.abs(kgPerWeek).toFixed(2)}`;
}

/**
 * The plan judged against the trend, plus the one adjustment that would close
 * the gap.
 *
 * The suggestion is offered, never applied on its own: an automatic target that
 * moves every time you weigh in is how these apps end up quietly starving
 * someone after a bad week.
 */
export function ProgressFlag({ progress, calorieGoal, onApply, applying }: ProgressFlagProps) {
  const color = statusColor[progress.status];
  const suggestion = progress.suggested_calorie_delta;
  const adjusted =
    calorieGoal !== null && suggestion !== null && suggestion !== 0
      ? Math.max(1200, calorieGoal + suggestion)
      : null;

  return (
    <Card style={{ ...styles.card, borderLeftColor: color }}>
      <View style={styles.head}>
        <Text style={[styles.flag, { color }]}>{LABEL[progress.status]}</Text>
        {progress.days_remaining > 0 ? (
          <Text style={styles.days}>{progress.days_remaining} days left</Text>
        ) : (
          <Text style={styles.days}>Target date reached</Text>
        )}
      </View>

      <Text style={styles.headline}>{progress.headline}</Text>

      <View style={styles.grid}>
        <Metric label="Plan pace" value={`${rate(progress.planned_rate_kg_per_week)} kg/wk`} />
        <Metric
          label="Your pace"
          value={`${rate(progress.actual_rate_kg_per_week)} kg/wk`}
          color={progress.actual_rate_kg_per_week === null ? colors.textDim : color}
        />
        <Metric label="Needed now" value={`${rate(progress.required_rate_kg_per_week)} kg/wk`} />
        <Metric
          label="Projected"
          value={
            progress.projected_kg_at_target !== null
              ? `${progress.projected_kg_at_target.toFixed(1)} kg`
              : '—'
          }
        />
      </View>

      {progress.projected_goal_date && progress.days_off_plan !== null ? (
        <Text style={styles.projection}>
          At this pace you'd hit the goal on {progress.projected_goal_date} —{' '}
          {progress.days_off_plan === 0
            ? 'exactly on time'
            : `${Math.abs(progress.days_off_plan)} days ${progress.days_off_plan > 0 ? 'late' : 'early'}`}
          .
        </Text>
      ) : null}

      {suggestion === null ? (
        <Text style={styles.note}>
          {progress.actual_rate_kg_per_week === null
            ? 'Weigh in a few more times across a week and the pace check turns on.'
            : 'No adjustment while the plan has fewer than seven days left.'}
        </Text>
      ) : suggestion === 0 ? (
        <Text style={styles.note}>Your intake is where it needs to be — nothing to change.</Text>
      ) : (
        <View style={styles.suggestion}>
          <Text style={styles.suggestText}>
            {suggestion < 0 ? 'Eat' : 'Add'} <Text style={{ color, fontFamily: fonts.bold }}>{Math.abs(suggestion)} kcal</Text>{' '}
            {suggestion < 0 ? 'less' : 'more'} a day to land on the goal by the target date
            {adjusted !== null ? ` — ${adjusted.toLocaleString()} kcal instead of ${calorieGoal!.toLocaleString()}` : ''}.
          </Text>
          {adjusted !== null ? (
            <Button
              title={applying ? 'Updating…' : `Set target to ${adjusted.toLocaleString()} kcal`}
              variant="ghost"
              onPress={() => onApply(adjusted)}
              disabled={applying}
              style={styles.apply}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderLeftWidth: 3, marginTop: 16 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  flag: { ...type.overline, letterSpacing: 1.6, fontFamily: fonts.bold },
  days: { color: colors.textDim, fontSize: 12 },
  headline: { color: colors.text, fontSize: 14.5, lineHeight: 20, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  metric: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  metricLabel: { ...type.overline, fontSize: 9.5, color: colors.textDim },
  metricValue: { ...type.figureSmall, color: colors.text, fontFamily: fonts.semibold, fontSize: 15, marginTop: 3 },
  projection: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 12 },
  note: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 12 },
  suggestion: { marginTop: 14 },
  suggestText: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
  apply: { marginTop: 10 },
});
