import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { goalsApi, onboardingApi, profileApi } from '@/api';
import type { GoalPlanInput } from '@/api/goals';
import { enqueueActivity, enqueueGoals, flush as flushQueue, subscribeRejections } from '@/api/queue';
import { cached, readCache } from '@/cache';
import { emitGoalsChanged } from '@/goalsBus';
import {
  Button,
  Card,
  EmptyState,
  OptionRow,
  PillGroup,
  Screen,
  SkeletonCard,
  StaleNotice,
  StatTile,
  TextField,
} from '@/components/ui';
import { colors, fonts, statusColor, type } from '@/theme';
import { addDays, todayISO } from '@/dates';
import {
  ACTIVITY,
  ActivityLevel,
  GOALS,
  Goal,
  RATE_OPTIONS,
  calcBMR,
  calcTDEE,
  computeMacros,
  dailyDelta,
  nearestRate,
} from '@/nutrition';
import { EXERCISE_KINDS, describeExercise, netExerciseKcal } from '@/exercise';
import { GoalsPayload, ProfileBasics } from '@/types';
import { editorTargets } from '@/features/goals/editorTargets';
import { GlideChart } from '@/features/goals/GlideChart';
import { WeightTrendChart } from '@/features/goals/WeightTrendChart';
import { ProgressFlag } from '@/features/goals/ProgressFlag';
import { StepsChart } from '@/features/goals/StepsChart';

const STATUS_LABEL = { ahead: 'AHEAD', on: 'ON PACE', watch: 'WATCH', behind: 'BEHIND', empty: '—' } as const;

interface PlanForm {
  start_weight_kg: number;
  start_date: string;
  goal_weight_kg: number;
  target_date: string;
  tolerance_kg: number;
  daily_step_goal: number | null;
  weekly_training_days: number | null;
  daily_calorie_goal: number | null;
  daily_protein_goal_g: number | null;
  daily_carbs_goal_g: number | null;
  daily_fat_goal_g: number | null;
}

const DEFAULT_FORM: PlanForm = {
  start_weight_kg: 70,
  start_date: todayISO(),
  goal_weight_kg: 68,
  target_date: addDays(todayISO(), 56),
  tolerance_kg: 0.3,
  daily_step_goal: 10000,
  weekly_training_days: 4,
  daily_calorie_goal: 1900,
  daily_protein_goal_g: 150,
  daily_carbs_goal_g: 190,
  daily_fat_goal_g: 63,
};

export default function Plan() {
  const [data, setData] = useState<GoalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A write the server refused, kept apart from `error`.
   *
   * `load()` clears `error` on every call, and a rejection is always followed
   * by a reload — so the message was being wiped in the same tick it was set,
   * and a refused weigh-in looked exactly like a successful one.
   */
  const [writeError, setWriteError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const [profile, setProfile] = useState<ProfileBasics | null>(null);
  /**
   * The editor's choices all start empty, exactly as they do in onboarding.
   * Pre-selecting them meant the screen recalculated a plan the moment it
   * opened and overwrote the saved targets with one nobody had asked for. With
   * nothing selected there is nothing to recalculate *from*, so the saved
   * numbers stay put until a real choice is made.
   */
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editRate, setEditRate] = useState<number | null>(null);
  const [editActivity, setEditActivity] = useState<ActivityLevel | null>(null);
  /** A measurement rather than a choice, so this one is prefilled. */
  const [editWeight, setEditWeight] = useState(70);
  const [editTargetWeight, setEditTargetWeight] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const [form, setForm] = useState<PlanForm>(DEFAULT_FORM);

  const [logWeight, setLogWeight] = useState('');
  const [logSteps, setLogSteps] = useState('');
  const [logExercise, setLogExercise] = useState<string | null>(null);
  const [logMinutes, setLogMinutes] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logMsg, setLogMsg] = useState<string | null>(null);
  /** SVG needs a concrete width; measured from the container. */
  const [chartWidth, setChartWidth] = useState(0);

  const canCompute = !!profile?.height_cm && !!profile?.age && !!profile?.gender;

  /** Maintenance, once an activity level has been chosen. */
  const editTdee = useMemo(() => {
    if (!canCompute || !profile || !editActivity) return null;
    const bmr = calcBMR(editWeight, profile.height_cm!, profile.age!, profile.gender!);
    return calcTDEE(bmr, editActivity);
  }, [canCompute, profile, editWeight, editActivity]);

  /**
   * Null until the choices are complete, which is what keeps the saved targets
   * on screen. The rule itself lives in `editorTargets.ts`, under test.
   */
  const editMacros = useMemo(
    () => editorTargets(editTdee, editWeight, editGoal, editRate),
    [editTdee, editWeight, editGoal, editRate]
  );

  const editDelta = editGoal === 'maintain' || editRate === null ? 0 : dailyDelta(editRate);
  const editRateOptions = editGoal ? RATE_OPTIONS[editGoal] : [];

  // Push the computed plan into the form. `editMacros` is null until the user
  // has actually chosen an activity level, a goal and a pace, so this cannot
  // fire off pre-selected values the way it used to.
  useEffect(() => {
    if (!canCompute || !editMacros || !editGoal) return;
    const goalW = editGoal === 'maintain' ? editWeight : (editTargetWeight ?? editWeight);
    let targetDate: string;
    if (editGoal !== 'maintain' && editTargetWeight && editRate) {
      const weeks = Math.max(1, Math.abs(editTargetWeight - editWeight) / editRate);
      targetDate = addDays(todayISO(), Math.round(weeks * 7));
    } else {
      targetDate = addDays(todayISO(), 56);
    }
    setForm((f) => ({
      ...f,
      start_weight_kg: editWeight,
      // Re-baseline the start only for a brand-new plan. Moving an existing
      // plan's start date to today would throw away the glide path you've been
      // weighing in against.
      start_date: data?.plan ? f.start_date : todayISO(),
      goal_weight_kg: goalW,
      target_date: targetDate,
      daily_calorie_goal: editMacros.calories,
      daily_protein_goal_g: editMacros.protein_g,
      daily_carbs_goal_g: editMacros.carbs_g,
      daily_fat_goal_g: editMacros.fat_g,
    }));
  }, [canCompute, editGoal, editRate, editWeight, editTargetWeight, editMacros, data?.plan]);

  /**
   * Picking a goal clears the pace rather than defaulting it: the pace options
   * differ per goal, and carrying one over would be a selection the user never
   * made — the whole complaint about this screen.
   */
  const pickEditGoal = (g: Goal) => {
    setEditGoal(g);
    setEditRate(null);
    setAiNote(null);
  };

  const openEditor = async (payload: GoalsPayload | null) => {
    setEditing(true);
    setAiNote(null);
    // Every choice starts empty, for a new plan and an existing one alike.
    setEditGoal(null);
    setEditRate(null);
    setEditActivity(null);
    setEditTargetWeight(null);
    const plan = payload?.plan;
    if (plan) {
      // Seed the form from the plan that's actually saved, so the editor opens
      // showing the current plan rather than a freshly calculated one.
      setForm((f) => ({
        ...f,
        ...plan,
        daily_calorie_goal: payload!.macros.calories ?? f.daily_calorie_goal,
        daily_protein_goal_g: payload!.macros.protein_g ?? f.daily_protein_goal_g,
        daily_carbs_goal_g: payload!.macros.carbs_g ?? f.daily_carbs_goal_g,
        daily_fat_goal_g: payload!.macros.fat_g ?? f.daily_fat_goal_g,
      }));
    }
    const p = await profileApi.getProfile();
    setProfile(p);
    // The weight is a fact about today, not a choice, so it's prefilled from
    // the latest weigh-in. Everything else waits to be picked.
    setEditWeight(payload?.latest_weight ?? plan?.start_weight_kg ?? 70);
  };

  /** What the plan currently implies, shown as context beside the empty choices. */
  const savedShape = useMemo(() => {
    const plan = data?.plan;
    if (!plan) return null;
    const goal: Goal =
      plan.goal_weight_kg < plan.start_weight_kg
        ? 'cut'
        : plan.goal_weight_kg > plan.start_weight_kg
          ? 'lean_bulk'
          : 'maintain';
    const days = (Date.parse(plan.target_date) - Date.parse(plan.start_date)) / 86_400_000;
    const implied = days > 0 ? (Math.abs(plan.goal_weight_kg - plan.start_weight_kg) / days) * 7 : 0;
    return { goal, rate: nearestRate(goal, implied) };
  }, [data?.plan]);

  const refineWithAI = async () => {
    if (!editTdee || !editMacros || !profile || !editGoal || !editActivity) return;
    setAiBusy(true);
    setAiNote(null);
    try {
      const bmr = calcBMR(editWeight, profile.height_cm!, profile.age!, profile.gender!);
      const res = await onboardingApi.postAiPlan({
        display_name: '',
        gender: profile.gender,
        age: profile.age,
        height_cm: profile.height_cm,
        weight_kg: editWeight,
        activity_level: editActivity,
        goal: editGoal,
        target_weight_kg: editTargetWeight,
        target_rate_kg_per_week: editRate || null,
        bmr,
        tdee: editTdee,
        baseline: editMacros,
      });
      if (res?.plan) {
        setForm((f) => ({
          ...f,
          daily_calorie_goal: res.plan.daily_calorie_goal,
          daily_protein_goal_g: res.plan.daily_protein_goal_g,
          daily_carbs_goal_g: res.plan.daily_carbs_goal_g,
          daily_fat_goal_g: res.plan.daily_fat_goal_g,
        }));
        setAiNote(res.plan.summary);
      } else {
        setAiNote('AI is unavailable right now — using the calculated targets.');
      }
    } finally {
      setAiBusy(false);
    }
  };

  /** Applies a payload to both the readouts and the edit form. */
  const apply = (payload: GoalsPayload) => {
    setData(payload);
    if (payload.plan) {
      setForm((f) => ({
        ...f,
        ...payload.plan!,
        daily_calorie_goal: payload.macros.calories,
        daily_protein_goal_g: payload.macros.protein_g,
        daily_carbs_goal_g: payload.macros.carbs_g,
        daily_fat_goal_g: payload.macros.fat_g,
      }));
    }
  };

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      // Paint the cached plan first so switching to this tab isn't a spinner.
      const seed = await readCache<GoalsPayload>('goals');
      if (seed && !isRefresh) {
        apply(seed);
        setLoading(false);
      }
      const { data: payload, stale: fromCache } = await cached('goals', () => goalsApi.getGoals());
      setStale(fromCache);
      setData(payload);
      if (payload.plan) {
        setForm((f) => ({
          ...f,
          ...payload.plan!,
          daily_calorie_goal: payload.macros.calories,
          daily_protein_goal_g: payload.macros.protein_g,
          daily_carbs_goal_g: payload.macros.carbs_g,
          daily_fat_goal_g: payload.macros.fat_g,
        }));
      } else {
        setForm((f) => ({ ...f, start_date: todayISO(), target_date: addDays(todayISO(), 56) }));
        await openEditor(payload);
      }
    } catch {
      setError("Couldn't load your goals.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  /**
   * Drain whatever this screen queued while offline. Coming back to the tab and
   * returning to the app are both moments when the connection may have
   * returned — Today does the same for meals.
   */
  const drain = useCallback(async () => {
    const synced = await flushQueue();
    if (synced > 0) {
      await load();
      emitGoalsChanged();
    }
  }, []);

  useEffect(() => {
    void drain();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void drain();
    });
    return () => sub.remove();
  }, [drain]);

  // A plan or weigh-in the server refuses is dropped from the queue, so the
  // screen is about to revert to the server's version. Say so rather than
  // letting the numbers change back on their own.
  useEffect(
    () =>
      subscribeRejections(['activity', 'goals'], (kind, message) => {
        console.warn(`Rejected ${kind}:`, message);
        setWriteError(
          kind === 'goals'
            ? "The server wouldn't accept that plan, so it hasn't been saved."
            : "The server wouldn't accept that weigh-in, so it hasn't been saved. If you logged a session, this server may not support them yet."
        );
        void load();
      }),
    []
  );

  const planValid =
    form.target_date > form.start_date && form.start_weight_kg > 0 && form.goal_weight_kg > 0;

  const impliedRate = useMemo(() => {
    if (!planValid) return null;
    const days = (Date.parse(form.target_date) - Date.parse(form.start_date)) / 86_400_000;
    if (days <= 0) return null;
    return ((form.goal_weight_kg - form.start_weight_kg) / days) * 7;
  }, [planValid, form.target_date, form.start_date, form.goal_weight_kg, form.start_weight_kg]);

  const rateWarning = useMemo(() => {
    if (impliedRate === null) return null;
    const perWeek = Math.abs(impliedRate);
    if (perWeek > 1.0) {
      return `That's ${perWeek.toFixed(2)} kg/week. Above roughly 1 kg you start losing muscle alongside fat — consider a later date.`;
    }
    if (perWeek < 0.15 && perWeek > 0) {
      return `That's only ${perWeek.toFixed(2)} kg/week, slow enough that normal weight fluctuation will hide it.`;
    }
    return null;
  }, [impliedRate]);

  /**
   * Queues a plan write and drains it. Anything the network swallows stays on
   * the device and goes out later, so the editor can close on the user's terms
   * rather than the connection's.
   *
   * The other tabs are only told once the server has it: they re-read from the
   * API, so announcing an unsent change would have them fetch the old numbers
   * and look like the save had been undone.
   */
  const queuePlan = async (plan: GoalPlanInput): Promise<void> => {
    await enqueueGoals(plan);
    const synced = await flushQueue();
    if (synced > 0) {
      await load();
      emitGoalsChanged();
    }
  };

  const save = async () => {
    if (!planValid) return;
    setSaving(true);
    setError(null);
    setWriteError(null);
    try {
      await queuePlan(form);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Applies the adaptive suggestion: only the calorie target moves, and the
   * macros move with it so protein doesn't quietly become a bigger share of a
   * smaller budget. The plan's weights and dates are untouched — the point is
   * to still hit the plan, not to redraw it.
   */
  const applySuggestion = async (calories: number) => {
    if (!data?.plan) return;
    setApplying(true);
    setError(null);
    try {
      const protein = form.daily_protein_goal_g ?? data.macros.protein_g;
      const fat = Math.round((calories * 0.25) / 9);
      await queuePlan({
        ...form,
        ...data.plan,
        daily_calorie_goal: calories,
        daily_protein_goal_g: protein,
        daily_fat_goal_g: fat,
        daily_carbs_goal_g: Math.max(0, Math.round((calories - (protein ?? 0) * 4 - fat * 9) / 4)),
      });
    } finally {
      setApplying(false);
    }
  };

  /** Leaves the editor with the saved plan intact, discarding any tweaks. */
  const cancelEdit = () => {
    setEditing(false);
    setAiNote(null);
    if (data) apply(data);
  };

  /**
   * The pace flag. Prefers the server's trend-based verdict and falls back to
   * the last weekly marker, so a cached payload from before `progress` existed
   * still shows something.
   */
  const paceStatus = useMemo(() => {
    if (data?.progress) return data.progress.status;
    const logged = data?.glide_path.filter((w) => w.actual_kg !== null) ?? [];
    return logged.length ? logged[logged.length - 1]!.status : null;
  }, [data]);

  const remaining = useMemo(() => {
    const plan = data?.plan;
    const latest = data?.latest_weight;
    if (!plan || latest == null) return null;
    return Math.max(0, Math.abs(latest - plan.goal_weight_kg));
  }, [data]);

  // The 14-day average now lives in StepsChart; the readout shows today so the
  // tile reflects the day you're actually looking at.
  const stepsToday = useMemo(
    () => data?.activity.find((a) => a.activity_date === todayISO())?.steps ?? null,
    [data]
  );

  const recentDeficit = data?.weekly_deficit.length ? data.weekly_deficit[data.weekly_deficit.length - 1] : null;

  /** Today's logged session, if there is one. */
  const exerciseToday = useMemo(() => {
    const row = data?.activity.find((a) => a.activity_date === todayISO());
    if (!row?.exercise_minutes || !row.exercise_type) return null;
    return { text: describeExercise(row.exercise_type, row.exercise_minutes), kcal: row.exercise_kcal ?? 0 };
  }, [data]);

  /** The last fortnight of sessions, newest first. */
  const recentExercise = useMemo(
    () =>
      (data?.activity ?? [])
        .filter((a) => a.exercise_minutes && a.exercise_type)
        .slice(-14)
        .reverse(),
    [data]
  );

  /**
   * A weigh-in is the one number in this app that can't be reconstructed later
   * — you can remember what you ate, you cannot remember what the scale said —
   * and the adaptive plan is fitted to them. So it goes to the durable queue
   * first and syncs when it can, rather than being lost to a bad connection.
   */
  /**
   * The net energy of a logged session, priced against today's weight — the
   * same figure the server adds to the day's expenditure.
   */
  const loggedBurn = useMemo(() => {
    const minutes = Number(logMinutes);
    if (!logExercise || !Number.isFinite(minutes) || minutes <= 0) return 0;
    const weight = data?.latest_weight ?? data?.plan?.start_weight_kg ?? 70;
    return netExerciseKcal(logExercise, minutes, weight);
  }, [logExercise, logMinutes, data?.latest_weight, data?.plan?.start_weight_kg]);

  const saveLog = async () => {
    if (!logWeight && !logSteps && !loggedBurn) return;
    setLogBusy(true);
    setLogMsg(null);
    setWriteError(null);
    try {
      await enqueueActivity({
        activity_date: todayISO(),
        weight_kg: logWeight ? Number(logWeight) : null,
        steps: logSteps ? Number(logSteps) : null,
        // Omitted entirely when there's no session, not sent as null:
        // `POST /api/activity` is `.strict()`, so a server without the
        // exercise columns rejects the *whole* payload — taking the weigh-in
        // and the step count down with it.
        ...(loggedBurn
          ? {
              exercise_type: logExercise,
              exercise_minutes: Number(logMinutes),
              exercise_kcal: loggedBurn,
            }
          : {}),
      });
      setLogWeight('');
      setLogSteps('');
      setLogExercise(null);
      setLogMinutes('');
      const synced = await flushQueue();
      if (synced > 0) {
        setLogMsg('Saved for today.');
        await load();
      } else {
        setLogMsg("Saved on this device — it'll sync when you're back online.");
      }
    } finally {
      setLogBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Text style={styles.eyebrow}>PLAN</Text>
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (error && !data) {
    return (
      <Screen>
        <Text style={styles.eyebrow}>PLAN</Text>
        <EmptyState message={error} />
        <Button title="Try again" variant="ghost" onPress={load} style={{ marginTop: 12 }} />
      </Screen>
    );
  }

  if (!data) return null;

  const showViewMode = !editing && data.plan;

  return (
    <Screen refreshing={refreshing} onRefresh={() => load(true)}>
      <Text style={styles.eyebrow}>PLAN</Text>

      {stale ? <StaleNotice /> : null}
      {/* A write the server refused sets this. Without somewhere to show it,
          the screen just silently reverted — the same class of bug as the
          dropped entry edit. */}
      {writeError ? <Text style={styles.errorNote}>{writeError}</Text> : null}
      {error && data ? <Text style={styles.errorNote}>{error}</Text> : null}

      {showViewMode ? (
        <View>
          <Text style={styles.h1}>
            Descent to <Text style={styles.accentNum}>{data.plan!.goal_weight_kg.toFixed(1)}</Text>
          </Text>
          <Text style={styles.sub}>
            {data.plan!.start_weight_kg.toFixed(1)} kg on {data.plan!.start_date} → {data.plan!.goal_weight_kg.toFixed(1)} kg by{' '}
            {data.plan!.target_date}
          </Text>

          <View style={styles.readouts}>
            <StatTile label="Current" value={data.latest_weight?.toFixed(1) ?? '—'} unit="kg" />
            <StatTile label="Remaining" value={remaining?.toFixed(1) ?? '—'} unit="kg" color={colors.cyan} />
            <StatTile
              label="Pace"
              value={paceStatus ? STATUS_LABEL[paceStatus] : '—'}
              color={paceStatus ? statusColor[paceStatus] : undefined}
            />
            {exerciseToday ? (
              <StatTile label="Activity today" value={exerciseToday.text} color={colors.purple} />
            ) : (
              <StatTile label="Steps today" value={stepsToday?.toLocaleString() ?? '—'} />
            )}
          </View>

          {data.progress ? (
            <ProgressFlag
              progress={data.progress}
              calorieGoal={data.macros.calories}
              onApply={applySuggestion}
              applying={applying}
            />
          ) : null}

          <Card style={styles.logCard}>
            <View style={styles.grid2}>
              <TextField
                testID="log-weight"
                label="Today's weight (kg)"
                keyboardType="decimal-pad"
                placeholder="—"
                style={styles.half}
                value={logWeight}
                onChangeText={setLogWeight}
              />
              <TextField
                testID="log-steps"
                label="Today's steps"
                keyboardType="number-pad"
                placeholder="—"
                style={styles.half}
                value={logSteps}
                onChangeText={setLogSteps}
              />
            </View>
            {/* Steps miss everything that isn't walking. A day with a game of
                football and 2,000 steps is not a sedentary day, and without
                this the plan couldn't tell the two apart. */}
            <Text style={styles.logSectionH}>Anything else today?</Text>
            <PillGroup
              columns={3}
              options={EXERCISE_KINDS.map((k) => ({ value: k.key, label: k.label }))}
              value={logExercise}
              onChange={(k) => setLogExercise(logExercise === k ? null : k)}
            />
            {logExercise ? (
              <View style={styles.exerciseRow}>
                <TextField
                  testID="log-minutes"
                  label="For how long? (min)"
                  keyboardType="number-pad"
                  placeholder="e.g. 45"
                  style={styles.half}
                  value={logMinutes}
                  onChangeText={(v) => setLogMinutes(v.replace(/[^0-9]/g, ''))}
                />
                <View style={styles.burnBox}>
                  <Text style={styles.burnLabel}>Counts as</Text>
                  <Text style={styles.burnValue}>{loggedBurn ? `${loggedBurn} kcal` : '—'}</Text>
                </View>
              </View>
            ) : null}

            <Button
              title={logBusy ? 'Saving…' : 'Log for today'}
              onPress={saveLog}
              disabled={logBusy || (!logWeight && !logSteps && !loggedBurn)}
            />
            {logMsg ? <Text style={styles.logMsg}>{logMsg}</Text> : null}
            {logExercise ? (
              <Text style={styles.burnNote}>
                Energy above resting, so it doesn't double-count the movement your maintenance calories
                already assume. It raises the day's expenditure in your weekly deficit.
              </Text>
            ) : null}
          </Card>

          {/* Daily weigh-ins against the plan line. Falls back to the weekly
              glide path for payloads cached before the daily series existed. */}
          <View style={styles.chartWrap} onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}>
            {data.weigh_ins?.length ? (
              <WeightTrendChart
                plan={data.plan!}
                weighIns={data.weigh_ins}
                progress={data.progress}
                width={chartWidth}
              />
            ) : data.glide_path.length ? (
              <GlideChart weeks={data.glide_path} tolerance={data.plan!.tolerance_kg} width={chartWidth} />
            ) : (
              <EmptyState message="Log your weight for a few days and the trend against your plan appears here." />
            )}
          </View>

          <StepsChart activity={data.activity} goal={data.plan!.daily_step_goal} />

          {recentExercise.length ? (
            <>
              <Text style={styles.h2}>Sessions logged</Text>
              <Card>
                {recentExercise.map((a) => (
                  <View key={a.activity_date} style={styles.wrow}>
                    <Text style={styles.wdate}>{a.activity_date}</Text>
                    <Text style={styles.wval}>{describeExercise(a.exercise_type!, a.exercise_minutes!)}</Text>
                    <Text style={styles.wproj}>+{(a.exercise_kcal ?? 0).toLocaleString()} kcal</Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <Text style={styles.h2}>Daily targets</Text>
          <View style={styles.targets}>
            <TargetCard label="Calories" value={data.macros.calories ?? '—'} stripe={colors.cyan} />
            <TargetCard label="Protein" value={data.macros.protein_g ?? '—'} unit="g" stripe={colors.accent} />
            <TargetCard label="Steps" value={data.plan!.daily_step_goal?.toLocaleString() ?? '—'} stripe={colors.warn} />
            <TargetCard label="Training" value={data.plan!.weekly_training_days ?? '—'} unit="/wk" stripe={colors.purple} />
          </View>

          <Text style={styles.h2}>Weekly deficit</Text>
          {data.weekly_deficit.length === 0 ? (
            <EmptyState message="Needs at least four logged days in a week, plus a recorded TDEE from a weigh-in. Log consistently for a week and this fills in." />
          ) : (
            <Card>
              {data.weekly_deficit.slice(-6).map((w) => (
                <View key={w.week_start} style={styles.wrow}>
                  <Text style={styles.wdate}>{w.week_start}</Text>
                  <Text style={styles.wval}>{w.total_deficit.toLocaleString()} kcal</Text>
                  <Text style={styles.wproj}>≈ {w.projected_kg.toFixed(2)} kg</Text>
                  <Text style={styles.wdays}>{w.days_logged}d</Text>
                </View>
              ))}
              {recentDeficit ? (
                <Text style={styles.footnote}>
                  Projection uses 7700 kcal per kg. Expenditure comes from your recorded TDEE — health-app active
                  energy is deliberately not added on top, since TDEE already assumes your usual movement. Sessions
                  you log by hand are added, at their energy above resting, because your activity level can't have
                  anticipated them.
                </Text>
              ) : null}
            </Card>
          )}

          <Button title="Edit plan" variant="ghost" onPress={() => openEditor(data)} style={{ marginTop: 16 }} />
        </View>
      ) : (
        <View>
          <Text style={styles.h1}>{data.plan ? 'Edit plan' : 'Set your plan'}</Text>
          <Text style={styles.sub}>
            Same questions as setup, starting from blank. Your current targets stay exactly as they are until
            you choose something.
          </Text>

          {canCompute ? (
            <Card style={{ marginTop: 16 }}>
              <View style={styles.grid2}>
                <TextField
                  label="Current weight (kg)"
                  keyboardType="decimal-pad"
                  style={styles.half}
                  value={String(editWeight)}
                  onChangeText={(v) => setEditWeight(Number(v) || 0)}
                />
              </View>

              <Text style={styles.formH}>How active are you?</Text>
              <View style={styles.optionList}>
                {(Object.keys(ACTIVITY) as ActivityLevel[]).map((k) => (
                  <OptionRow
                    key={k}
                    title={ACTIVITY[k].label}
                    hint={ACTIVITY[k].hint}
                    value={savedShape && profile?.activity_level === k ? 'current' : undefined}
                    selected={editActivity === k}
                    onPress={() => setEditActivity(k)}
                  />
                ))}
              </View>
              <Text style={styles.maintLine}>
                {editTdee
                  ? `Maintenance ≈ ${editTdee.toLocaleString()} kcal/day`
                  : 'Pick an activity level to see your maintenance calories.'}
              </Text>

              <Text style={styles.formH}>Pick your goal</Text>
              <View style={styles.optionList}>
                {(Object.keys(GOALS) as Goal[]).map((k) => (
                  <OptionRow
                    key={k}
                    title={GOALS[k].label}
                    hint={GOALS[k].blurb}
                    // The kcal preview needs a maintenance figure, so it only
                    // appears once an activity level has been chosen.
                    value={
                      editTdee
                        ? `${computeMacros(editTdee, editWeight, k).calories.toLocaleString()} kcal`
                        : savedShape?.goal === k
                          ? 'current'
                          : undefined
                    }
                    selected={editGoal === k}
                    onPress={() => pickEditGoal(k)}
                  />
                ))}
              </View>

              {editRateOptions.length ? (
                <>
                  <Text style={styles.formH}>
                    How fast?{' '}
                    {editRate !== null ? (
                      <Text style={styles.deltaHint}>
                        ≈ {editDelta} kcal/day {editGoal === 'cut' ? 'deficit' : 'surplus'}
                      </Text>
                    ) : null}
                  </Text>
                  <PillGroup
                    columns={3}
                    options={editRateOptions.map((r) => ({
                      value: String(r.kg),
                      label: r.label,
                      tag:
                        editTdee && editGoal
                          ? `${computeMacros(editTdee, editWeight, editGoal, r.kg).calories.toLocaleString()} kcal`
                          : r.tag,
                      // Faintly mark the pace the saved plan implies, but only
                      // while looking at that plan's own goal — the same pace
                      // number means something different under another goal.
                      current: savedShape?.goal === editGoal && savedShape?.rate === r.kg,
                    }))}
                    value={editRate !== null ? String(editRate) : null}
                    onChange={(v) => setEditRate(Number(v))}
                  />
                  <View style={styles.fieldGroupSpacer} />
                  <TextField
                    label="Goal weight (kg) — optional"
                    keyboardType="decimal-pad"
                    // The saved goal weight as the placeholder: it says what
                    // you're currently aiming at without filling the field in,
                    // which would be a choice you didn't make.
                    placeholder={
                      data.plan ? `currently ${data.plan.goal_weight_kg.toFixed(1)}` : editGoal === 'cut' ? 'e.g. 68' : 'e.g. 78'
                    }
                    value={editTargetWeight != null ? String(editTargetWeight) : ''}
                    onChangeText={(v) => setEditTargetWeight(v ? Number(v) : null)}
                  />
                </>
              ) : null}

              <Text style={styles.formH}>Your daily targets</Text>
              <Text style={styles.targetsNote}>
                {editMacros
                  ? 'Recalculated from your choices above.'
                  : 'Your current targets — choose an activity level, a goal and a pace to recalculate them.'}
              </Text>
              <View style={styles.targets}>
                <TargetCard label="Calories" value={form.daily_calorie_goal ?? '—'} stripe={colors.cyan} />
                <TargetCard label="Protein" value={form.daily_protein_goal_g ?? '—'} unit="g" stripe={colors.accent} />
                <TargetCard label="Carbs" value={form.daily_carbs_goal_g ?? '—'} unit="g" stripe={colors.warn} />
                <TargetCard label="Fat" value={form.daily_fat_goal_g ?? '—'} unit="g" stripe={colors.purple} />
              </View>

              {/* The coach refines the numbers your choices produced, so it
                  has nothing to work from until they've been made. */}
              <Button
                title={aiBusy ? 'Thinking…' : '✨ Refine with AI coach'}
                variant="ghost"
                onPress={refineWithAI}
                disabled={aiBusy || !editMacros}
                style={{ marginTop: 14 }}
              />
              {aiNote ? (
                <View style={styles.aiNote}>
                  <Text style={styles.aiNoteHead}>🥗 Coach</Text>
                  <Text style={styles.aiNoteText}>{aiNote}</Text>
                </View>
              ) : null}

              <Button
                title={showAdvanced ? '▾ Hide fine-tune' : '▸ Fine-tune numbers & steps'}
                variant="ghost"
                onPress={() => setShowAdvanced((v) => !v)}
                style={{ marginTop: 12 }}
              />
              {showAdvanced ? (
                <View style={{ marginTop: 8 }}>
                  <View style={styles.grid2}>
                    <TextField
                      label="Calories"
                      keyboardType="number-pad"
                      style={styles.half}
                      value={String(form.daily_calorie_goal ?? '')}
                      onChangeText={(v) => setForm((f) => ({ ...f, daily_calorie_goal: Number(v) || null }))}
                    />
                    <TextField
                      label="Protein (g)"
                      keyboardType="number-pad"
                      style={styles.half}
                      value={String(form.daily_protein_goal_g ?? '')}
                      onChangeText={(v) => setForm((f) => ({ ...f, daily_protein_goal_g: Number(v) || null }))}
                    />
                  </View>
                  <View style={styles.grid2}>
                    <TextField
                      label="Carbs (g)"
                      keyboardType="number-pad"
                      style={styles.half}
                      value={String(form.daily_carbs_goal_g ?? '')}
                      onChangeText={(v) => setForm((f) => ({ ...f, daily_carbs_goal_g: Number(v) || null }))}
                    />
                    <TextField
                      label="Fat (g)"
                      keyboardType="number-pad"
                      style={styles.half}
                      value={String(form.daily_fat_goal_g ?? '')}
                      onChangeText={(v) => setForm((f) => ({ ...f, daily_fat_goal_g: Number(v) || null }))}
                    />
                  </View>
                  <View style={styles.grid2}>
                    <TextField
                      label="Daily steps"
                      keyboardType="number-pad"
                      style={styles.half}
                      value={String(form.daily_step_goal ?? '')}
                      onChangeText={(v) => setForm((f) => ({ ...f, daily_step_goal: Number(v) || null }))}
                    />
                    <TextField
                      label="Training days/wk"
                      keyboardType="number-pad"
                      style={styles.half}
                      value={String(form.weekly_training_days ?? '')}
                      onChangeText={(v) => setForm((f) => ({ ...f, weekly_training_days: Number(v) || null }))}
                    />
                  </View>
                </View>
              ) : null}

              <View style={styles.row}>
                {data.plan ? (
                  <Button title="Cancel" variant="ghost" onPress={cancelEdit} style={styles.flex1} />
                ) : null}
                {/* A first plan has no saved targets to fall back on, so it
                    can't be saved until the choices have produced some. */}
                <Button
                  title={saving ? 'Saving…' : 'Save plan'}
                  onPress={save}
                  disabled={!planValid || saving || (!data.plan && !editMacros)}
                  style={styles.flex2}
                />
              </View>
            </Card>
          ) : (
            <View>
              <Card style={{ marginTop: 16, marginBottom: 12 }}>
                <Text style={styles.dim}>
                  Add your height, age and sex during onboarding to auto-calculate targets. For now, enter them
                  manually:
                </Text>
              </Card>
              <Card>
                <View style={styles.grid2}>
                  <TextField
                    label="Start weight (kg)"
                    keyboardType="decimal-pad"
                    style={styles.half}
                    value={String(form.start_weight_kg)}
                    onChangeText={(v) => setForm((f) => ({ ...f, start_weight_kg: Number(v) || 0 }))}
                  />
                  <TextField
                    label="Goal weight (kg)"
                    keyboardType="decimal-pad"
                    style={styles.half}
                    value={String(form.goal_weight_kg)}
                    onChangeText={(v) => setForm((f) => ({ ...f, goal_weight_kg: Number(v) || 0 }))}
                  />
                </View>
                <View style={styles.grid2}>
                  <TextField
                    label="Start date"
                    style={styles.half}
                    value={form.start_date}
                    onChangeText={(v) => setForm((f) => ({ ...f, start_date: v }))}
                  />
                  <TextField
                    label="Target date"
                    style={styles.half}
                    value={form.target_date}
                    onChangeText={(v) => setForm((f) => ({ ...f, target_date: v }))}
                  />
                </View>
                {rateWarning ? (
                  <Text style={styles.warnNote}>{rateWarning}</Text>
                ) : impliedRate !== null ? (
                  <Text style={styles.rateText}>Implied pace: {Math.abs(impliedRate).toFixed(2)} kg/week</Text>
                ) : null}

                <Text style={styles.formH}>Daily targets</Text>
                <View style={styles.grid2}>
                  <TextField
                    label="Calories"
                    keyboardType="number-pad"
                    style={styles.half}
                    value={String(form.daily_calorie_goal ?? '')}
                    onChangeText={(v) => setForm((f) => ({ ...f, daily_calorie_goal: Number(v) || null }))}
                  />
                  <TextField
                    label="Protein (g)"
                    keyboardType="number-pad"
                    style={styles.half}
                    value={String(form.daily_protein_goal_g ?? '')}
                    onChangeText={(v) => setForm((f) => ({ ...f, daily_protein_goal_g: Number(v) || null }))}
                  />
                </View>
                <View style={styles.grid2}>
                  <TextField
                    label="Carbs (g)"
                    keyboardType="number-pad"
                    style={styles.half}
                    value={String(form.daily_carbs_goal_g ?? '')}
                    onChangeText={(v) => setForm((f) => ({ ...f, daily_carbs_goal_g: Number(v) || null }))}
                  />
                  <TextField
                    label="Fat (g)"
                    keyboardType="number-pad"
                    style={styles.half}
                    value={String(form.daily_fat_goal_g ?? '')}
                    onChangeText={(v) => setForm((f) => ({ ...f, daily_fat_goal_g: Number(v) || null }))}
                  />
                </View>

                <View style={styles.row}>
                  {data.plan ? (
                    <Button title="Cancel" variant="ghost" onPress={cancelEdit} style={styles.flex1} />
                  ) : null}
                  <Button title={saving ? 'Saving…' : 'Save plan'} onPress={save} disabled={!planValid || saving} style={styles.flex2} />
                </View>
              </Card>
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

function TargetCard({ label, value, unit, stripe }: { label: string; value: string | number; unit?: string; stripe: string }) {
  return (
    <View style={[styles.targetCard, { borderLeftColor: stripe }]}>
      <Text style={styles.targetLabel}>{label}</Text>
      <Text style={styles.targetValue}>
        {value}
        {unit ? <Text style={styles.targetUnit}>{unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { ...type.overline, color: colors.accent, letterSpacing: 2.5, marginBottom: 10 },
  dim: { color: colors.textDim, fontSize: 14 },
  h1: { color: colors.text, fontSize: 30, fontFamily: fonts.extrabold },
  accentNum: { color: colors.accent },
  sub: { color: colors.textDim, fontSize: 14, marginTop: 8 },
  h2: { color: colors.text, fontSize: 18, fontFamily: fonts.bold, marginTop: 24, marginBottom: 10 },
  formH: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, marginTop: 18, marginBottom: 8 },
  readouts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20, marginBottom: 4 },
  chartWrap: { marginBottom: 12 },
  logCard: { marginTop: 16, marginBottom: 16 },
  logSectionH: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold, marginTop: 4, marginBottom: 8 },
  exerciseRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 12 },
  burnBox: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 18,
  },
  burnLabel: { ...type.overline, color: colors.textDim },
  burnValue: { ...type.figureSmall, fontSize: 16, fontFamily: fonts.semibold, color: colors.accent, marginTop: 2 },
  burnNote: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, marginTop: 10 },
  logMsg: { color: colors.accent, fontSize: 13, textAlign: 'center', marginTop: 10 },
  errorNote: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  grid2: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  targetCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 14,
  },
  targetLabel: { ...type.overline, color: colors.textDim },
  targetValue: { color: colors.text, fontSize: 22, fontFamily: fonts.bold, marginTop: 6 },
  targetUnit: { fontSize: 12, color: colors.textDim, fontFamily: fonts.regular },
  wrow: { flexDirection: 'row', gap: 10, alignItems: 'baseline', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  wdate: { ...type.figureSmall, fontSize: 12, color: colors.textDim, flex: 1 },
  wval: { ...type.figureSmall, fontFamily: fonts.semibold, color: colors.text },
  wproj: { ...type.figureSmall, fontSize: 12, color: colors.textDim },
  wdays: { color: colors.textDim, fontSize: 12 },
  footnote: { color: colors.textDim, fontSize: 12, marginTop: 12, lineHeight: 17 },
  label: { color: colors.textDim, fontSize: 12, marginTop: 8, marginBottom: 6 },
  /** Stacked choices, matching onboarding's spacing. */
  optionList: { gap: 8 },
  targetsNote: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: -2, marginBottom: 10 },
  /** Gap between a PillGroup and a following labelled field. */
  fieldGroupSpacer: { height: 14 },
  maintLine: { color: colors.accent, fontSize: 13, marginTop: 8 },
  deltaHint: { color: colors.accent, fontSize: 11, fontFamily: fonts.regular },
  aiNote: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginTop: 12 },
  aiNoteHead: { color: colors.accent, fontSize: 12, fontFamily: fonts.bold },
  aiNoteText: { color: colors.text, fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  warnNote: { color: colors.warn, fontSize: 13, backgroundColor: 'rgba(251,191,36,0.1)', borderRadius: 10, padding: 10, marginTop: 4 },
  rateText: { ...type.figureSmall, color: colors.text, marginTop: 4 },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
});
