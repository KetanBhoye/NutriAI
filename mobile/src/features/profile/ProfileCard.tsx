import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { profileApi } from '@/api';
import { Button, OptionRow, PillGroup, Sheet, TextField } from '@/components/ui';
import { ACTIVITY, type ActivityLevel } from '@/nutrition';
import { colors, fonts, radius, type } from '@/theme';
import { ProfileBasics } from '@/types';

/**
 * Your height, age, sex and activity level — and a way to change them.
 *
 * They were collected once at onboarding and then frozen: a mistyped height or
 * a birthday meant a permanently wrong BMR, because nothing in the app called
 * `PUT /api/profile` even though the server has always accepted it. These
 * numbers set the calorie target every other screen is measured against, so
 * being unable to correct them is not a small gap.
 *
 * Saving does not recompute the daily targets on its own. That is deliberate:
 * targets can be hand-edited on the Plan tab, and silently overwriting a number
 * someone chose would be worse than leaving it. The card says so instead.
 */
export function ProfileCard() {
  const [profile, setProfile] = useState<ProfileBasics | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    height: '',
    age: '',
    gender: null as 'male' | 'female' | null,
    activity: null as ActivityLevel | null,
  });

  const load = () => {
    void profileApi.getProfile().then(setProfile);
  };
  useEffect(load, []);

  const open = () => {
    setError(null);
    setForm({
      height: profile?.height_cm != null ? String(profile.height_cm) : '',
      age: profile?.age != null ? String(profile.age) : '',
      gender: profile?.gender ?? null,
      activity: profile?.activity_level ?? null,
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only send what was filled in: the server treats every field as
      // optional, and sending an empty one as 0 would fail validation and lose
      // the rest of the edit with it.
      const height = Number(form.height);
      const age = Number(form.age);
      await profileApi.updateProfile({
        ...(form.height.trim() && Number.isFinite(height) ? { height_cm: height } : {}),
        ...(form.age.trim() && Number.isFinite(age) ? { age } : {}),
        ...(form.gender ? { gender: form.gender } : {}),
        ...(form.activity ? { activity_level: form.activity } : {}),
      });
      setEditing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  };

  const summary = profile
    ? [
        profile.height_cm != null ? `${profile.height_cm} cm` : null,
        profile.age != null ? `${profile.age} yrs` : null,
        profile.gender ? (profile.gender === 'male' ? 'Male' : 'Female') : null,
        profile.activity_level ? ACTIVITY[profile.activity_level].label : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <>
      <Pressable style={styles.card} onPress={open}>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Body profile</Text>
          <Text style={styles.sub}>{summary || 'Set your height, age and activity level'}</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Body profile">
        <TextField
          testID="profile-height"
          label="Height (cm)"
          keyboardType="number-pad"
          value={form.height}
          onChangeText={(v) => setForm((f) => ({ ...f, height: v.replace(/[^0-9]/g, '') }))}
        />
        <TextField
          testID="profile-age"
          label="Age"
          keyboardType="number-pad"
          value={form.age}
          onChangeText={(v) => setForm((f) => ({ ...f, age: v.replace(/[^0-9]/g, '') }))}
        />

        <Text style={styles.label}>Sex</Text>
        <PillGroup
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
          value={form.gender}
          onChange={(v) => setForm((f) => ({ ...f, gender: v }))}
        />
        <Text style={styles.hint}>Used for the BMR formula, which differs by sex.</Text>

        <Text style={styles.label}>Activity level</Text>
        {(Object.keys(ACTIVITY) as ActivityLevel[]).map((key) => (
          <OptionRow
            key={key}
            title={ACTIVITY[key].label}
            hint={ACTIVITY[key].hint}
            selected={form.activity === key}
            onPress={() => setForm((f) => ({ ...f, activity: key }))}
          />
        ))}

        <Text style={styles.hint}>
          These set your maintenance calories. Your daily targets don't change on their own — edit
          them on the Plan tab if you want them recalculated.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: 16,
  },
  textWrap: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, fontFamily: fonts.medium },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  chev: { color: colors.textDim, fontSize: 22 },
  label: { ...type.overline, color: colors.textDim, marginTop: 16, marginBottom: 8 },
  hint: { ...type.caption, color: colors.textDim, marginTop: 8, marginBottom: 4 },
  error: { ...type.caption, color: colors.danger, marginVertical: 8 },
});
