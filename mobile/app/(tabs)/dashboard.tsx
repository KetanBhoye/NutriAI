import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dashboardApi, goalsApi } from '@/api';
import { useCachedResource } from '@/useCachedResource';
import { writeCache } from '@/cache';
import { subscribeGoalsChanged } from '@/goalsBus';
import { FALLBACK_GOALS } from '@/nutrition';
import { toLocalISODate } from '@/dates';
import { colors, fonts, type } from '@/theme';
import { Button, Card, EmptyState, Screen, SkeletonCard, StaleNotice, StatTile } from '@/components/ui';
import { WeeklyInsights, WeeklyStats } from '@/types';

/** Shared with Today via `src/nutrition.ts`, so the two can't disagree. */
const FALLBACK_GOAL_CALORIES = FALLBACK_GOALS.calories;
/** Height of the plot area itself; the weekday label sits below it. */
const PLOT_HEIGHT = 140;
const MIN_BAR_HEIGHT = 3;

interface Bar {
  date: string;
  calories: number;
  /** Pixel height within the plot area. Computed here rather than as a CSS
   *  percentage — percentage heights need a definite parent height, which is
   *  easy to break when the column also holds a label. */
  height: number;
  over: boolean;
  missing: boolean;
  label: string;
}

function buildBars(stats: WeeklyStats, goalCalories: number): { bars: Bar[]; goalLineBottom: number } {
  const byDate = new Map(stats.daily.map((d) => [d.entry_date, d]));
  const peak = Math.max(goalCalories, ...stats.daily.map((d) => d.calories), 1);
  const bars: Bar[] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = toLocalISODate(date);
    const logged = byDate.get(key);
    bars.push({
      date: key,
      calories: logged?.calories ?? 0,
      height: logged ? Math.max(MIN_BAR_HEIGHT, (logged.calories / peak) * PLOT_HEIGHT) : 0,
      over: (logged?.calories ?? 0) > goalCalories,
      missing: !logged,
      label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
    });
  }
  return { bars, goalLineBottom: (goalCalories / peak) * PLOT_HEIGHT };
}

export default function Trends() {
  const stats = useCachedResource('stats.weekly', () => dashboardApi.getWeeklyStats(30), {
    errorMessage: "Couldn't load your trends.",
  });
  const goals = useCachedResource('goals', () => goalsApi.getGoals());
  // The weekly report is an LLM call and the server caches it per day, so it
  // is the most valuable thing to serve from cache and refresh behind.
  const report = useCachedResource('insights.weekly', () => dashboardApi.getWeeklyInsights(), {
    errorMessage: "Couldn't load your weekly report.",
  });

  // The goal line has to move when the plan does, and this tab stays mounted
  // while the plan is edited on another one.
  const refreshGoals = goals.refresh;
  useEffect(() => subscribeGoalsChanged(() => void refreshGoals()), [refreshGoals]);

  const [refreshingReport, setRefreshingReport] = useState(false);
  const regenerateReport = async () => {
    setRefreshingReport(true);
    try {
      const fresh = await dashboardApi.getWeeklyInsights(true);
      await writeCache('insights.weekly', fresh);
      await report.refresh();
    } catch {
      // leave the existing report on screen
    } finally {
      setRefreshingReport(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([stats.refresh(), goals.refresh(), report.refresh()]);
  };

  const goalCalories = goals.data?.macros.calories ?? FALLBACK_GOAL_CALORIES;

  const { bars, goalLineBottom } = useMemo(
    () => (stats.data ? buildBars(stats.data, goalCalories) : { bars: [] as Bar[], goalLineBottom: 0 }),
    [stats.data, goalCalories]
  );
  const missedDays = bars.filter((b) => b.missing).length;

  return (
    <Screen refreshing={stats.refreshing || report.refreshing} onRefresh={refreshAll}>
      <Text style={styles.title}>Trends</Text>

      {stats.stale || report.stale ? <StaleNotice /> : null}

      <Card style={styles.reportCard}>
        <View style={styles.reportHead}>
          <Text style={styles.reportEyebrow}>🥗 Weekly report</Text>
          <Button
            title={refreshingReport ? '…' : '↻ Refresh'}
            variant="ghost"
            onPress={regenerateReport}
            disabled={refreshingReport || report.loading}
            style={styles.refreshBtn}
          />
        </View>

        {report.loading ? (
          <SkeletonCard lines={4} />
        ) : report.data?.report ? (
          <View>
            <Text style={styles.reportHeadline}>{report.data.report.headline}</Text>
            <Text style={styles.reportSummary}>{report.data.report.summary}</Text>

            {report.data.report.wins.length ? (
              <View style={styles.reportList}>
                <Text style={styles.reportListTitle}>What went well</Text>
                {report.data.report.wins.map((w, i) => (
                  <View key={`w${i}`} style={styles.reportItem}>
                    <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                    <Text style={styles.reportItemText}>{w}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {report.data.report.focus.length ? (
              <View style={styles.reportList}>
                <Text style={styles.reportListTitle}>Focus next week</Text>
                {report.data.report.focus.map((f, i) => (
                  <View key={`f${i}`} style={styles.reportItem}>
                    <View style={[styles.dot, { backgroundColor: colors.warn }]} />
                    <Text style={styles.reportItemText}>{f}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {report.data.source === 'rule' ? (
              <Text style={styles.reportNote}>Based on your numbers (AI coach unavailable right now).</Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.dim}>Not enough data yet for a weekly report.</Text>
        )}
      </Card>

      {stats.loading ? (
        <SkeletonCard lines={5} />
      ) : stats.error && !stats.data ? (
        <View>
          <EmptyState message={stats.error} />
          <Button title="Try again" variant="ghost" onPress={() => stats.refresh()} style={{ marginTop: 12 }} />
        </View>
      ) : stats.data ? (
        <>
          <View style={styles.statsRow}>
            <StatTile label="Day streak" value={String(stats.data.streak)} />
            <StatTile label="Avg kcal" value={String(stats.data.average_calories)} />
            <StatTile label="Days logged" value={`${stats.data.complete_days}`} unit="/30" />
          </View>

          <Text style={styles.sectionTitle}>Last 14 days</Text>

          {bars.length === 0 ? (
            <EmptyState message="No entries in the last 30 days. Log something today and your trend starts here." />
          ) : (
            <Card style={styles.chartCard}>
              <View style={styles.plot}>
                <View style={[styles.goalLine, { bottom: goalLineBottom }]}>
                  <Text style={styles.goalLabel}>{goalCalories.toLocaleString()}</Text>
                </View>
                {bars.map((bar) => (
                  <View key={bar.date} style={styles.barCol}>
                    {bar.missing ? (
                      <View style={styles.barMissing} />
                    ) : (
                      <View style={[styles.bar, { height: bar.height }, bar.over && styles.barOver]} />
                    )}
                  </View>
                ))}
              </View>
              <View style={styles.labelRow}>
                {bars.map((bar) => (
                  <Text key={bar.date} style={styles.barLabel}>
                    {bar.label}
                  </Text>
                ))}
              </View>
            </Card>
          )}

          <Text style={styles.footnote}>
            {missedDays > 0 ? `${missedDays} of the last 14 days have nothing logged (shown as gaps). ` : ''}
            A day counts toward the streak once it passes {stats.data.complete_day_threshold} kcal, so a half-finished
            log doesn't count as a full day.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontFamily: fonts.extrabold, marginBottom: 16 },
  reportCard: { marginBottom: 16 },
  reportHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reportEyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontFamily: fonts.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  refreshBtn: { paddingHorizontal: 10, minHeight: 30 },
  dim: { color: colors.textDim, fontSize: 14 },
  reportHeadline: { color: colors.text, fontSize: 18, fontFamily: fonts.bold, marginBottom: 8 },
  reportSummary: { color: colors.text, fontSize: 14, lineHeight: 20 },
  reportList: { marginTop: 14 },
  reportListTitle: { ...type.overline, color: colors.textDim, marginBottom: 6 },
  reportItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 3 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  reportItemText: { color: colors.text, fontSize: 13.5, lineHeight: 19, flex: 1 },
  reportNote: { color: colors.textDim, fontSize: 11, marginTop: 12 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  sectionTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.bold, marginBottom: 10 },
  chartCard: { paddingTop: 22 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: PLOT_HEIGHT },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  barOver: { backgroundColor: colors.warn },
  barMissing: { width: '100%', height: PLOT_HEIGHT, backgroundColor: colors.surface2, borderRadius: 4, opacity: 0.4 },
  goalLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: colors.textDim,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  goalLabel: { ...type.figureSmall, position: 'absolute', right: 0, top: -14, color: colors.textDim, fontSize: 10 },
  labelRow: { flexDirection: 'row', gap: 5, marginTop: 6 },
  barLabel: { flex: 1, color: colors.textDim, fontSize: 10, textAlign: 'center' },
  footnote: { color: colors.textDim, fontSize: 12.5, marginTop: 14, lineHeight: 18 },
});
