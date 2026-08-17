import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui';
import { API_URL } from '@/config';
import { colors, space } from '@/theme';

/**
 * Asks for agreement from accounts that predate the signup checkbox, or whose
 * agreement is to a superseded version of the documents.
 *
 * An overlay rather than a route: it has to block use of the app, and routing
 * it would mean fighting the gate in app/_layout.tsx that already decides
 * between login, onboarding and the tabs.
 *
 * Two deliberate choices about when it appears:
 *
 *   Only on an explicit `false`. A server that has not been deployed yet, or an
 *   older response shape, leaves `consent_current` undefined — and undefined
 *   must not lock anyone out of an app they are already using. Failing open
 *   here is right because the alternative is bricking the app on a deploy skew.
 *
 *   Not dismissable. There is no close button and no backdrop tap. Consent that
 *   can be swiped away is not consent, and a "later" option means the record
 *   never gets made for the people least likely to read it.
 */
export function ConsentGate() {
  const { user, refreshUser } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needed = Boolean(user) && user?.consent_current === false;
  if (!needed) return null;

  const submit = async () => {
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/consent', { method: 'POST', body: { accepted_terms: true } });
      // Re-reading is what actually dismisses this: the flag comes from the
      // server, so the overlay cannot get out of step with what was recorded.
      await refreshUser();
    } catch {
      setError('Could not save that. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>We&apos;ve updated our terms</Text>
          <Text style={styles.body}>
            NutriAI now sets out clearly how your data — including health data from Apple Health or
            Health Connect — is stored and used. Please read and accept to carry on.
          </Text>

          <Pressable
            style={styles.consent}
            onPress={() => setAccepted((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: accepted }}
            accessibilityLabel="Accept the Terms of Service and Privacy Policy"
          >
            <View style={[styles.box, accepted && styles.boxOn]}>
              {accepted ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>
              I agree to the{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(`${API_URL}/terms`)}>
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(`${API_URL}/privacy`)}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title="Agree and continue" onPress={submit} busy={busy} disabled={!accepted} />

          {/*
            Deleting the account is the only alternative to agreeing, and saying
            so is more honest than a dead end. It is also what makes this a
            choice rather than a demand.
          */}
          <Text style={styles.footnote}>
            Prefer not to?{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(`${API_URL}/privacy#deleting`)}>
              You can delete your account
            </Text>
            .
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: space.xl,
    gap: space.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontSize: 14, fontWeight: '900', lineHeight: 16 },
  consentText: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 19 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  error: { color: colors.danger, fontSize: 13 },
  footnote: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: -space.xs },
});
