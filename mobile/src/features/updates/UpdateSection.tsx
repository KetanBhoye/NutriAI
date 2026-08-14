import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import {
  checkForUpdate,
  currentVersion,
  downloadApk,
  installApk,
  InstallError,
  openInstallPermissionSettings,
  UPDATES_SUPPORTED,
  type UpdateCheck,
} from '@/updates';
import { Button } from '@/components/ui';
import { colors, fonts, radius, type } from '@/theme';

/**
 * The Updates card in the You tab (Android only).
 *
 * NutriAI isn't on the Play Store, so this is the only thing that will ever
 * tell someone a new build exists. It checks once when the tab opens — quietly,
 * because nobody asked — and only says anything if there's something to install.
 *
 * The one piece of friction worth knowing about: Android requires the user to
 * allow "install unknown apps" for NutriAI, once. The system prompts for it
 * when the install is blocked, but a user who declines has no obvious route
 * back, so `openInstallPermissionSettings` is offered after a failure.
 */

type Phase = 'idle' | 'checking' | 'downloading' | 'installing';

export function UpdateSection() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Offer the Settings shortcut only once an install has actually failed. */
  const [blocked, setBlocked] = useState(false);

  // A silent check on mount: no spinner, and nothing shown if we're current.
  // A failure here is invisible on purpose — the user didn't ask, so a red
  // error about a background request they never made would be noise.
  useEffect(() => {
    if (!UPDATES_SUPPORTED) return;
    let cancelled = false;
    checkForUpdate()
      .then((result) => {
        if (!cancelled) setCheck(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Notice when the install didn't happen.
   *
   * A successful install replaces this process, so if we're handed the
   * foreground back while still in `installing`, it failed or was declined —
   * Android tells the user "App not installed" and tells the app nothing at
   * all. Without this the card sits on "Opening installer…" under a green
   * success message, which is a lie about the state of the world.
   */
  useEffect(() => {
    if (phase !== 'installing') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      setPhase('idle');
      setFailed(true);
      setMessage(
        "The update wasn't installed. Android will say why — most often there isn't enough free space, " +
          'or the install was declined. Nothing changed, and you can try again.'
      );
    });
    return () => sub.remove();
  }, [phase]);

  if (!UPDATES_SUPPORTED) {
    return (
      <View>
        <Text style={styles.version}>Version {currentVersion()}</Text>
        <Text style={styles.note}>
          {Platform.OS === 'ios'
            ? 'iOS builds update through TestFlight or the App Store — an app installed this way cannot replace itself.'
            : 'In-app updates are available on Android.'}
        </Text>
      </View>
    );
  }

  const runCheck = async () => {
    setPhase('checking');
    setMessage(null);
    setFailed(false);
    try {
      const result = await checkForUpdate();
      setCheck(result);
      if (!result.available) {
        setMessage(
          result.latestVersion
            ? "You're on the latest version."
            : 'No published build to update to yet.'
        );
      }
    } catch {
      setFailed(true);
      setMessage("Couldn't reach NutriAI to check for updates. Check your connection.");
    } finally {
      setPhase('idle');
    }
  };

  const runUpdate = async () => {
    if (!check?.latestVersion) return;
    setPhase('downloading');
    setProgress(0);
    setMessage(null);
    setFailed(false);
    setBlocked(false);
    try {
      const fileUri = await downloadApk(check.url, check.latestVersion, check.sizeBytes, setProgress);
      setPhase('installing');
      await installApk(fileUri);
      // Control now belongs to the system installer. If the user confirms, this
      // process is replaced by the new build and nothing below ever runs — so
      // reaching the foreground again means it did NOT install (see the
      // AppState effect below).
      setMessage('Confirm the install when Android asks. Your data stays as it is.');
    } catch (e) {
      setFailed(true);
      setBlocked(e instanceof InstallError && /unknown apps/i.test(e.message));
      setMessage(e instanceof Error ? e.message : 'The update failed.');
      setPhase('idle');
    }
  };

  const busy = phase === 'downloading' || phase === 'installing';

  return (
    <View>
      <Text style={styles.version}>Version {check?.currentVersion ?? currentVersion()}</Text>

      {check?.available ? (
        <>
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>UPDATE AVAILABLE</Text>
            </View>
            <Text style={styles.newVersion}>
              {check.latestVersion}
              {check.sizeLabel ? ` · ${check.sizeLabel}` : ''}
            </Text>
          </View>

          {check.notes ? <Text style={styles.notes}>{check.notes}</Text> : null}

          {phase === 'downloading' ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          ) : null}

          <Button
            title={
              phase === 'downloading'
                ? `Downloading… ${Math.round(progress * 100)}%`
                : phase === 'installing'
                  ? 'Opening installer…'
                  : `Update to ${check.latestVersion}`
            }
            onPress={runUpdate}
            disabled={busy}
          />
          <Text style={styles.note}>
            Installs over the top — you won't lose anything, and there's no need to uninstall first.
          </Text>
        </>
      ) : (
        <Button
          title={phase === 'checking' ? 'Checking…' : 'Check for updates'}
          variant="ghost"
          onPress={runCheck}
          busy={phase === 'checking'}
        />
      )}

      {message ? <Text style={[styles.message, failed && styles.messageFailed]}>{message}</Text> : null}

      {blocked ? (
        <Button title="Open install settings" variant="ghost" onPress={openInstallPermissionSettings} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  version: { ...type.figureSmall, fontSize: 13, color: colors.textDim, marginBottom: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  badge: {
    backgroundColor: 'rgba(74,222,128,0.14)',
    borderRadius: radius / 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { color: colors.accent, fontSize: 10, fontFamily: fonts.bold, letterSpacing: 1 },
  newVersion: { color: colors.text, fontSize: 14, fontFamily: fonts.medium },
  notes: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  note: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 10 },
  message: { color: colors.accent, fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  messageFailed: { color: colors.danger },
});
