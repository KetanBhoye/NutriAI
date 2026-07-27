import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { accountApi } from '@/api';
import { useAuth } from '@/auth';
import { Button, Card, Screen } from '@/components/ui';
import { colors, fonts, radius, type } from '@/theme';
import { HealthSyncSection } from '@/features/health/HealthSyncSection';
import { TokenCard } from '@/components/TokenCard';
import { RemindersCard } from '@/features/profile/RemindersCard';

export default function Profile() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const initial = (user?.name?.trim()?.[0] ?? '🙂').toUpperCase();

  const onSignOut = async () => {
    setSigningOut(true);
    await signOut();
  };

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await accountApi.deleteAccount();
      await signOut();
    } catch (e) {
      setDeleteError((e as Error).message || 'Could not delete the account.');
      setDeleting(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.eyebrow}>YOU</Text>

      <Card style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.who}>
          <Text style={styles.name}>{user?.name ?? '…'}</Text>
          <Text style={styles.email}>{user?.email ?? ''}</Text>
        </View>
      </Card>

      <Text style={styles.h2}>Goals</Text>
      <Pressable style={styles.linkCard} onPress={() => router.push('/(tabs)/goals')}>
        <View style={styles.linkTextWrap}>
          <Text style={styles.settingTitle}>Plan & daily targets</Text>
          <Text style={styles.settingSub}>
            {user?.goals?.calories ? `${user.goals.calories} kcal · ${user.goals.protein_g}g protein` : 'Set your calories, macros and weight goal'}
          </Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>

      <Text style={styles.h2}>Reminders</Text>
      <RemindersCard />

      <Text style={styles.h2}>Health sync</Text>
      <Card>
        <HealthSyncSection />
      </Card>

      <Text style={styles.h2}>Connections</Text>
      <TokenCard />

      <Text style={styles.h2}>Account</Text>
      <Button title={signingOut ? 'Signing out…' : 'Sign out'} variant="ghost" onPress={onSignOut} disabled={signingOut} />

      {!confirmingDelete ? (
        <Pressable style={styles.deleteRow} onPress={() => setConfirmingDelete(true)}>
          <Text style={styles.deleteLink}>Delete account</Text>
        </Pressable>
      ) : (
        <Card style={styles.dangerZone}>
          <Text style={styles.dzTitle}>Delete your account?</Text>
          <Text style={styles.dzBody}>
            This permanently deletes your profile, food log, weigh-ins, goals and all your data. This can't be
            undone.
          </Text>
          {deleteError ? <Text style={styles.dzError}>{deleteError}</Text> : null}
          <View style={styles.row}>
            <Button title="Cancel" variant="ghost" onPress={() => setConfirmingDelete(false)} disabled={deleting} style={styles.flex1} />
            <Button title={deleting ? 'Deleting…' : 'Delete everything'} variant="danger" onPress={onDelete} disabled={deleting} style={styles.flex1} />
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { ...type.overline, color: colors.accent, letterSpacing: 2.5, marginBottom: 14 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.onAccent, fontSize: 22, fontFamily: fonts.extrabold },
  who: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 18, fontFamily: fonts.bold },
  email: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  h2: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, marginTop: 22, marginBottom: 10 },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: 16,
  },
  linkTextWrap: { flex: 1, minWidth: 0 },
  settingTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.medium },
  settingSub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  chev: { color: colors.textDim, fontSize: 22 },
  deleteRow: { alignItems: 'center', marginTop: 18 },
  deleteLink: { color: colors.textDim, fontSize: 13, textDecorationLine: 'underline' },
  dangerZone: { marginTop: 16, borderColor: 'rgba(248,113,113,0.4)' },
  dzTitle: { color: colors.danger, fontSize: 15, fontFamily: fonts.bold, marginBottom: 6 },
  dzBody: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  dzError: { color: colors.danger, fontSize: 13, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
});
