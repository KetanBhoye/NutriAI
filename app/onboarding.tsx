import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/auth';
import { ApiError, onboardingApi } from '@/api';
import { emitGoalsChanged } from '@/goalsBus';
import { addDays, todayISO } from '@/dates';
import { Button, OptionRow, PillGroup, Screen, TextField } from '@/components/ui';
import { colors, fonts, type } from '@/theme';
import {
  ACTIVITY,
  ActivityLevel,
  GOALS,
  Gender,
  Goal,
  RATE_OPTIONS,
  calcBMR,
  calcTDEE,
  computeMacros,
  dailyDelta,
  defaultRate,
} from '@/nutrition';

const STEPS = ['About you', 'Maintenance', 'Your goal', 'Your plan'] as const;

export default function Onboarding() {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(user?.name && user.name !== 'You' ? user.name : '');
  const [gender, setGender] = useState<Gender | null>(null);
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState<ActivityLevel>('light');
  const [goal, setGoal] = useState<Goal>('cut');
  const [rate, setRate] = useState(defaultRate('cut'));
  const [targetWeight, setTargetWeight] = useState('');

  const [aiLoading, setAiLoading] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const [summary, setSummary] = useState('');
  const [plan, setPlan] = useState({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

  const ageN = Number(age) || null;
  const heightN = Number(height) || null;
  const weightN = Number(weight) || null;
  const targetWeightN = targetWeight ? Number(targetWeight) : null;

  const bmr = gender && ageN && heightN && weightN ? calcBMR(weightN, heightN, ageN, gender) : null;
  const tdee = bmr ? calcTDEE(bmr, activity) : null;
  const baseline = tdee && weightN ? computeMacros(tdee, weightN, goal, rate) : null;

  const rateOptions = RATE_OPTIONS[goal];
  const deltaKcal = goal === 'maintain' ? 0 : dailyDelta(rate);

  const targetDate =
    weightN && targetWeightN && goal !== 'maintain' && rate > 0
      ? (() => {
          const weeks = Math.abs(targetWeightN - weightN) / rate;
          return weeks < 1 ? null : addDays(todayISO(), Math.round(weeks * 7));
        })()
      : null;

  const step0Valid = name.trim().length > 0 && gender !== null && !!ageN && ageN >= 13 && !!heightN && heightN >= 120 && !!weightN && weightN >= 30;

  const pickGoal = (g: Goal) => {
    setGoal(g);
    setRate(defaultRate(g));
  };

  function fallbackSummary(finalPlan: typeof plan): string {
    const g = GOALS[goal];
    const pace = goal === 'maintain' ? '' : ` aiming for about ${rate} kg/week (${deltaKcal} kcal/day ${goal === 'cut' ? 'deficit' : 'surplus'})`;
    return (
      `${name.trim()} is focused on ${g.label.toLowerCase()}${pace} — ${g.blurb.toLowerCase()}. ` +
      `Maintenance is about ${tdee} kcal/day; the daily target is ${finalPlan.calories} kcal ` +
      `with ${finalPlan.protein_g}g protein, ${finalPlan.carbs_g}g carbs and ${finalPlan.fat_g}g fat. ` +
      `Prioritise hitting protein every day and staying near the calorie target. Eats mostly Indian home-cooked food.`
    );
  }

  const loadPlan = async () => {
    if (!baseline || !tdee || !bmr) return;
    setPlan(baseline);
    setAiLoading(true);
    setAiUsed(false);
    try {
      const res = await onboardingApi.postAiPlan({
        display_name: name.trim(),
        gender,
        age: ageN,
        height_cm: heightN,
        weight_kg: weightN!,
        activity_level: activity,
        goal,
        target_weight_kg: targetWeightN,
        target_rate_kg_per_week: rate || null,
        bmr,
        tdee,
        baseline,
      });
      if (res?.plan) {
        const p = {
          calories: res.plan.daily_calorie_goal,
          protein_g: res.plan.daily_protein_goal_g,
          carbs_g: res.plan.daily_carbs_goal_g,
          fat_g: res.plan.daily_fat_goal_g,
        };
        setPlan(p);
        setSummary(res.plan.summary);
        setAiUsed(true);
      } else {
        setSummary(fallbackSummary(baseline));
      }
    } catch {
      setSummary(fallbackSummary(baseline));
    } finally {
      setAiLoading(false);
    }
  };

  const next = async () => {
    setError(null);
    if (step === 0 && !step0Valid) {
      setError('Fill in your details to continue.');
      return;
    }
    if (step < STEPS.length - 1) {
      const nextStep = step + 1;
      setStep(nextStep);
      if (nextStep === 3) void loadPlan();
    }
  };

  const back = () => {
    setError(null);
    if (step > 0) setStep(step - 1);
  };

  const finish = async () => {
    setError(null);
    // Guard non-finite values too: a malformed plan would otherwise POST NaN,
    // which the server rejects as a generic 400 and surfaces as a misleading
    // "check your connection" error.
    const values = [plan.calories, plan.protein_g, plan.carbs_g, plan.fat_g];
    if (values.some((v) => !Number.isFinite(v))) {
      setError("Your targets didn't calculate correctly. Go back and try again.");
      return;
    }
    if (plan.calories < 800) {
      setError('Calorie target looks too low.');
      return;
    }
    setBusy(true);
    try {
      await onboardingApi.postOnboardingComplete({
        display_name: name.trim() || 'You',
        gender: gender!,
        age: ageN!,
        height_cm: heightN!,
        weight_kg: weightN!,
        activity_level: activity,
        goal,
        daily_calorie_goal: Math.round(plan.calories),
        daily_protein_goal_g: Math.round(plan.protein_g),
        daily_carbs_goal_g: Math.round(plan.carbs_g),
        daily_fat_goal_g: Math.round(plan.fat_g),
        target_weight_kg: targetWeightN,
        target_date: targetDate,
      });
      emitGoalsChanged();
      await refreshUser();
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : "Couldn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.progress}>
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.seg, i <= step && styles.segDone]} />
          ))}
        </View>
        <Text style={styles.stepnum} numberOfLines={1}>
          STEP {step + 1} OF {STEPS.length} · {STEPS[step].toUpperCase()}
        </Text>

        {step === 0 ? (
          <View>
            <Text style={styles.h1}>Let's set you up</Text>
            <Text style={styles.sub}>A few basics so I can work out your calories and macros.</Text>

            <TextField label="What should I call you?" placeholder="Your name" value={name} onChangeText={setName} />

            <Text style={styles.label}>Sex (for the calorie formula)</Text>
            <View style={styles.fieldGroup}>
              <PillGroup
                columns={2}
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
                value={gender ?? ''}
                onChange={(v) => setGender(v as Gender)}
              />
            </View>

            <View style={styles.grid3}>
              <TextField label="Age" keyboardType="number-pad" placeholder="27" style={styles.third} value={age} onChangeText={setAge} />
              <TextField label="Height (cm)" keyboardType="number-pad" placeholder="175" style={styles.third} value={height} onChangeText={setHeight} />
              <TextField label="Weight (kg)" keyboardType="decimal-pad" placeholder="72" style={styles.third} value={weight} onChangeText={setWeight} />
            </View>

            <Text style={styles.label}>How active are you?</Text>
            <View style={styles.optionList}>
              {(Object.keys(ACTIVITY) as ActivityLevel[]).map((key) => (
                <OptionRow
                  key={key}
                  title={ACTIVITY[key].label}
                  hint={ACTIVITY[key].hint}
                  selected={activity === key}
                  onPress={() => setActivity(key)}
                />
              ))}
            </View>
          </View>
        ) : step === 1 ? (
          <View>
            <Text style={styles.h1}>Your maintenance</Text>
            <Text style={styles.sub}>This is roughly what your body burns in a day at your activity level.</Text>

            <View style={styles.maintCard}>
              <Text style={styles.maintBig}>{tdee?.toLocaleString() ?? '—'}</Text>
              <Text style={styles.maintUnit}>kcal / day to maintain</Text>
              <View style={styles.maintRow}>
                <Text style={styles.maintRowLabel}>Resting (BMR)</Text>
                <Text style={styles.maintRowValue}>{bmr?.toLocaleString() ?? '—'} kcal</Text>
              </View>
              <View style={styles.maintRow}>
                <Text style={styles.maintRowLabel}>Activity</Text>
                <Text style={styles.maintRowValue}>
                  {ACTIVITY[activity].label} ×{ACTIVITY[activity].mult}
                </Text>
              </View>
            </View>
            <Text style={styles.note}>
              Eat around this to hold weight, less to lose fat, more to gain muscle. You'll pick a goal next.
            </Text>
          </View>
        ) : step === 2 ? (
          <View>
            <Text style={styles.h1}>Pick your goal</Text>
            <Text style={styles.sub}>I'll turn your maintenance into a daily calorie and macro target.</Text>

            <View style={styles.optionList}>
              {(Object.keys(GOALS) as Goal[]).map((key) => (
                <OptionRow
                  key={key}
                  title={GOALS[key].label}
                  hint={GOALS[key].blurb}
                  value={tdee ? `${computeMacros(tdee, weightN ?? 70, key).calories.toLocaleString()} kcal` : '—'}
                  selected={goal === key}
                  onPress={() => pickGoal(key)}
                />
              ))}
            </View>

            {rateOptions.length ? (
              <>
                <Text style={styles.formH}>
                  How fast? <Text style={styles.deltaHint}>≈ {deltaKcal} kcal/day {goal === 'cut' ? 'deficit' : 'surplus'}</Text>
                </Text>
                <PillGroup
                  columns={3}
                  options={rateOptions.map((r) => ({
                    value: String(r.kg),
                    label: r.label,
                    tag: tdee ? `${computeMacros(tdee, weightN ?? 70, goal, r.kg).calories.toLocaleString()} kcal` : r.tag,
                  }))}
                  value={String(rate)}
                  onChange={(v) => setRate(Number(v))}
                />
              </>
            ) : null}

            {goal !== 'maintain' ? (
              <View style={{ marginTop: 18 }}>
                <TextField
                  label="Goal weight (kg) — optional, sets your Plan tab glide path"
                  keyboardType="decimal-pad"
                  placeholder={goal === 'cut' ? 'e.g. 68' : 'e.g. 78'}
                  value={targetWeight}
                  onChangeText={setTargetWeight}
                />
                {targetDate ? (
                  <Text style={styles.targetHint}>
                    Projected: {weightN?.toFixed(1)} → {targetWeightN?.toFixed(1)} kg by {targetDate}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View>
            <Text style={styles.h1}>Your plan</Text>
            <Text style={styles.sub}>{aiUsed ? 'Personalised by your AI coach.' : 'Your daily targets — tweak any of them.'}</Text>

            {aiLoading ? (
              <View style={styles.aiLoading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.aiLoadingText}>Your coach is building a personalised plan…</Text>
              </View>
            ) : (
              <View>
                <View style={styles.macroGrid}>
                  <MacroInput label="Calories" value={plan.calories} onChange={(v) => setPlan((p) => ({ ...p, calories: v }))} stripe={colors.cyan} />
                  <MacroInput label="Protein (g)" value={plan.protein_g} onChange={(v) => setPlan((p) => ({ ...p, protein_g: v }))} stripe={colors.accent} />
                  <MacroInput label="Carbs (g)" value={plan.carbs_g} onChange={(v) => setPlan((p) => ({ ...p, carbs_g: v }))} stripe={colors.warn} />
                  <MacroInput label="Fat (g)" value={plan.fat_g} onChange={(v) => setPlan((p) => ({ ...p, fat_g: v }))} stripe={colors.purple} />
                </View>

                {summary ? (
                  <View style={styles.coachNote}>
                    <Text style={styles.coachNoteHead}>🥗 Your coach's notes</Text>
                    <Text style={styles.coachNoteText}>{summary}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.nav}>
          {step > 0 ? <Button title="Back" variant="ghost" onPress={back} disabled={busy} style={{ flex: 0 }} /> : null}
          {step < 3 ? (
            <Button title="Continue" onPress={next} disabled={step === 0 && !step0Valid} style={styles.flex1} />
          ) : (
            <Button title={busy ? 'Saving…' : 'Start tracking'} onPress={finish} disabled={busy || aiLoading} style={styles.flex1} />
          )}
        </View>
    </Screen>
  );
}

function MacroInput({ label, value, onChange, stripe }: { label: string; value: number; onChange: (v: number) => void; stripe: string }) {
  return (
    <View style={[styles.macroBox, { borderLeftColor: stripe }]}>
      <Text style={styles.macroLab}>{label}</Text>
      {/* Borderless on purpose — the surrounding card is already the field's
          visual container; a bordered input here reads as a double border. */}
      <TextInput
        keyboardType="number-pad"
        value={Number.isFinite(value) ? String(value) : ''}
        onChangeText={(v) => onChange(Number(v) || 0)}
        style={styles.macroInput}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.accent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  seg: { flex: 1, height: 4, borderRadius: 4, backgroundColor: colors.surface2 },
  segDone: { backgroundColor: colors.accent },
  stepnum: { ...type.overline, color: colors.textDim, marginBottom: 18 },
  h1: { color: colors.text, fontSize: 25, fontFamily: fonts.extrabold, marginBottom: 6 },
  sub: { color: colors.textDim, fontSize: 14, marginBottom: 22 },
  label: { color: colors.textDim, fontSize: 13, marginBottom: 8, marginTop: 4 },
  optionList: { gap: 8 },
  /** Matches TextField's own bottom margin so mixed rows line up. */
  fieldGroup: { marginBottom: 12 },
  grid3: { flexDirection: 'row', gap: 10 },
  third: { flex: 1 },
  maintCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 22, alignItems: 'center', marginBottom: 14 },
  maintBig: { ...type.figureLarge, fontSize: 46, lineHeight: 50, color: colors.accent },
  maintUnit: { color: colors.textDim, fontSize: 13, marginTop: 6, marginBottom: 16 },
  maintRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border },
  maintRowLabel: { color: colors.textDim, fontSize: 14 },
  maintRowValue: { color: colors.text, fontSize: 14 },
  note: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  formH: { color: colors.textDim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 22, marginBottom: 10 },
  deltaHint: { color: colors.accent, fontSize: 12, textTransform: 'none' },
  targetHint: { ...type.figureSmall, fontSize: 12, color: colors.accent, marginTop: 8 },
  aiLoading: { alignItems: 'center', gap: 14, paddingVertical: 40 },
  aiLoadingText: { color: colors.textDim, fontSize: 14 },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  macroBox: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 13,
  },
  macroLab: { ...type.overline, color: colors.textDim, marginBottom: 4 },
  macroInput: { color: colors.text, fontSize: 24, fontFamily: fonts.bold, padding: 0, marginTop: 2 },
  coachNote: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16 },
  coachNoteHead: { color: colors.accent, fontSize: 12, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  coachNoteText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13, marginTop: 16 },
  nav: { flexDirection: 'row', gap: 10, marginTop: 26 },
  flex1: { flex: 1 },
});
