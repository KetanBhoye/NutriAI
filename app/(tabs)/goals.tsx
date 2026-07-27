import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { goalsApi, onboardingApi, profileApi } from '@/api';
import { Button, Card, EmptyState, Loading, PillGroup, Screen, StatTile, TextField } from '@/components/ui';
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
  defaultRate,
} from '@/nutrition';
import { GoalsPayload, ProfileBasics } from '@/types';
import { GlideChart } from '@/features/goals/GlideChart';
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
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState<ProfileBasics | null>(null);
  const [editGoal, setEditGoal] = useState<Goal>('cut');
  const [editRate, setEditRate] = useState<number>(defaultRate('cut'));
  const [editWeight, setEditWeight] = useState(70);
  const [editActivity, setEditActivity] = useState<ActivityLevel>('light');
  const [editTargetWeight, setEditTargetWeight] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const [form, setForm] = useState<PlanForm>(DEFAULT_FORM);

  const [logWeight, setLogWeight] = useState('');
  const [logSteps, setLogSteps] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logMsg, setLogMsg] = useState<string | null>(null);
  /** SVG needs a concrete width; measured from the container. */
  const [chartWidth, setChartWidth] = useState(0);

  const canCompute = !!profile?.height_cm && !!profile?.age && !!profile?.gender;

  const editTdee = useMemo(() => {
    if (!canCompute || !profile) return null;
    const bmr = calcBMR(editWeight, profile.height_cm!, profile.age!, profile.gender!);
    return calcTDEE(bmr, editActivity);
  }, [canCompute, profile, editWeight, editActivity]);

  const editMacros = useMemo(
    () => (editTdee ? computeMacros(editTdee, editWeight, editGoal, editRate) : null),
    [editTdee, editWeight, editGoal, editRate]
  );

  const editDelta = editGoal === 'maintain' ? 0 : dailyDelta(editRate);
  const editRateOptions = RATE_OPTIONS[editGoal];

  // Push the auto-computed plan into the form whenever the smart controls change.
  useEffect(() => {
    if (!canCompute || !editMacros) return;
    const goalW = editGoal === 'maintain' ? editWeight : (editTargetWeight ?? editWeight);
    let targetDate: string;
    if (editGoal !== 'maintain' && editTargetWeight && editRate > 0) {
      const weeks = Math.max(1, Math.abs(editTargetWeight - editWeight) / editRate);
      targetDate = addDays(todayISO(), Math.round(weeks * 7));
    } else {
      targetDate = addDays(todayISO(), 56);
    }
    setForm((f) => ({
      ...f,
      start_weight_kg: editWeight,
      start_date: todayISO(),
      goal_weight_kg: goalW,
      target_date: targetDate,
      daily_calorie_goal: editMacros.calories,
      daily_protein_goal_g: editMacros.protein_g,
      daily_carbs_goal_g: editMacros.carbs_g,
      daily_fat_goal_g: editMacros.fat_g,
    }));
  }, [canCompute, editGoal, editRate, editWeight, editTargetWeight, editMacros]);

  const pickEditGoal = (g: Goal) => {
    setEditGoal(g);
    setEditRate(defaultRate(g));
    setAiNote(null);
  };

  const openEditor = async (payload: GoalsPayload | null) => {
    setEditing(true);
    setAiNote(null);
    const p = await profileApi.getProfile();
    setProfile(p);
    const plan = payload?.plan;
    setEditWeight(payload?.latest_weight ?? plan?.start_weight_kg ?? 70);
    setEditActivity(p?.activity_level ?? 'light');
    if (plan) {
      const g: Goal =
        plan.goal_weight_kg < plan.start_weight_kg ? 'cut' : plan.goal_weight_kg > plan.start_weight_kg ? 'lean_bulk' : 'maintain';
      setEditGoal(g);
      setEditTargetWeight(plan.goal_weight_kg === plan.start_weight_kg ? null : plan.goal_weight_kg);
      setEditRate(defaultRate(g));
    } else {
      setEditGoal('cut');
      setEditTargetWeight(null);
      setEditRate(defaultRate('cut'));
    }
  };

  const refineWithAI = async () => {
    if (!editTdee || !editMacros || !profile) return;
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

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await goalsApi.getGoals();
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
    }
  };

  useEffect(() => {
    load();
  }, []);

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

  const save = async () => {
    if (!planValid) return;
    setSaving(true);
    try {
      await goalsApi.saveGoals(form);
      setEditing(false);
      await load();
    } catch {
      setError("Couldn't save. Check your connection.");
    } finally {
      setSaving(false);
    }
  };

  const current = useMemo(() => {
    const logged = data?.glide_path.filter((w) => w.actual_kg !== null) ?? [];
    return logged.length ? logged[logged.length - 1] : null;
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

  const saveLog = async () => {
    if (!logWeight && !logSteps) return;
    setLogBusy(true);
    setLogMsg(null);
    try {
      await goalsApi.logActivity({
        activity_date: todayISO(),
        weight_kg: logWeight ? Number(logWeight) : null,
        steps: logSteps ? Number(logSteps) : null,
      });
      setLogMsg('Saved for today.');
      setLogWeight('');
      setLogSteps('');
      await load();
    } catch {
      setLogMsg("Couldn't save. Check your connection.");
    } finally {
      setLogBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <Text style={styles.eyebrow}>PLAN</Text>
        <Card>
          <Loading />
        </Card>
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
    <Screen>
      <Text style={styles.eyebrow}>PLAN</Text>

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
            <StatTile label="Pace" value={current ? STATUS_LABEL[current.status] : '—'} color={current ? statusColor[current.status] : undefined} />
            <StatTile label="Steps today" value={stepsToday?.toLocaleString() ?? '—'} />
          </View>

          <Card style={styles.logCard}>
            <View style={styles.grid2}>
              <TextField
                label="Today's weight (kg)"
                keyboardType="decimal-pad"
                placeholder="—"
                style={styles.half}
                value={logWeight}
                onChangeText={setLogWeight}
              />
              <TextField
                label="Today's steps"
                keyboardType="number-pad"
                placeholder="—"
                style={styles.half}
                value={logSteps}
                onChangeText={setLogSteps}
              />
            </View>
            <Button title={logBusy ? 'Saving…' : 'Log for today'} onPress={saveLog} disabled={logBusy || (!logWeight && !logSteps)} />
            {logMsg ? <Text style={styles.logMsg}>{logMsg}</Text> : null}
          </Card>

          <View style={styles.chartWrap} onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}>
            {data.glide_path.length ? (
              <GlideChart
                weeks={data.glide_path}
                tolerance={data.plan!.tolerance_kg}
                width={chartWidth}
              />
            ) : null}
          </View>

          <StepsChart activity={data.activity} goal={data.plan!.daily_step_goal} />

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
                  energy is deliberately not added on top, since TDEE already assumes your usual movement.
                </Text>
              ) : null}
            </Card>
          )}

          <Button title="Edit plan" variant="ghost" onPress={() => openEditor(data)} style={{ marginTop: 16 }} />
        </View>
      ) : (
        <View>
          <Text style={styles.h1}>{data.plan ? 'Edit plan' : 'Set your plan'}</Text>
          <Text style={styles.sub}>Pick a goal and pace — I'll recalculate your targets, just like setup.</Text>

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
              <Text style={styles.label}>Activity</Text>
              <PillGroup
                columns={2}
                options={(Object.keys(ACTIVITY) as ActivityLevel[]).map((k) => ({ value: k, label: ACTIVITY[k].label }))}
                value={editActivity}
                onChange={setEditActivity}
              />
              <Text style={styles.maintLine}>Maintenance ≈ {editTdee?.toLocaleString()} kcal/day</Text>

              <Text style={styles.formH}>Goal</Text>
              <PillGroup
                columns={2}
                options={(Object.keys(GOALS) as Goal[]).map((k) => ({ value: k, label: GOALS[k].label }))}
                value={editGoal}
                onChange={pickEditGoal}
              />

              {editRateOptions.length ? (
                <>
                  <Text style={styles.formH}>
                    Pace <Text style={styles.deltaHint}>≈ {editDelta} kcal/day {editGoal === 'cut' ? 'deficit' : 'surplus'}</Text>
                  </Text>
                  <PillGroup
                    columns={3}
                    options={editRateOptions.map((r) => ({ value: String(r.kg), label: r.label, tag: r.tag }))}
                    value={String(editRate)}
                    onChange={(v) => setEditRate(Number(v))}
                  />
                  <View style={styles.fieldGroupSpacer} />
                  <TextField
                    label="Goal weight (kg) — optional"
                    keyboardType="decimal-pad"
                    placeholder={editGoal === 'cut' ? 'e.g. 68' : 'e.g. 78'}
                    value={editTargetWeight != null ? String(editTargetWeight) : ''}
                    onChangeText={(v) => setEditTargetWeight(v ? Number(v) : null)}
                  />
                </>
              ) : null}

              <Text style={styles.formH}>Your daily targets</Text>
              <View style={styles.targets}>
                <TargetCard label="Calories" value={form.daily_calorie_goal ?? '—'} stripe={colors.cyan} />
                <TargetCard label="Protein" value={form.daily_protein_goal_g ?? '—'} unit="g" stripe={colors.accent} />
                <TargetCard label="Carbs" value={form.daily_carbs_goal_g ?? '—'} unit="g" stripe={colors.warn} />
                <TargetCard label="Fat" value={form.daily_fat_goal_g ?? '—'} unit="g" stripe={colors.purple} />
              </View>

              <Button
                title={aiBusy ? 'Thinking…' : '✨ Refine with AI coach'}
                variant="ghost"
                onPress={refineWithAI}
                disabled={aiBusy}
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
                  <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={styles.flex1} />
                ) : null}
                <Button title={saving ? 'Saving…' : 'Save plan'} onPress={save} disabled={!planValid || saving} style={styles.flex2} />
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
                    <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={styles.flex1} />
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
  logMsg: { color: colors.accent, fontSize: 13, textAlign: 'center', marginTop: 10 },
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
