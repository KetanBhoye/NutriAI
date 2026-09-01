import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Button } from '@/components/ui';
import { colors, type } from '@/theme';

/**
 * App version and updates, in a browser.
 *
 * The Android build has to install updates itself — it is distributed as an
 * APK, so nothing else would ever tell a phone a new build exists (see
 * UpdateSection.tsx and src/updates/). A PWA has the opposite problem: it
 * updates *too* quietly. The service worker fetches the new build in the
 * background and then waits, so someone who leaves the tab open for days is
 * running old code with no idea, and a bug they reported stays fixed only for
 * people who happened to close it.
 *
 * So this is the same card doing the same job through the only mechanism the
 * platform offers: watch for a worker that has downloaded a new build and is
 * waiting, and offer the reload that activates it. Nothing is downloaded on
 * demand here — that already happened — which is why there is no progress bar
 * and why the button is instant.
 */
export function UpdateSection() {
  const version = (Constants.expoConfig?.version as string | undefined) ?? '—';
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let cancelled = false;

    (async () => {
      const registration = await navigator.serviceWorker.getRegistration('/m/').catch(() => null);
      if (!registration || cancelled) return;

      // A build downloaded before this screen was ever opened — the common
      // case, since the worker installs it the moment the tab loads.
      if (registration.waiting) setWaiting(registration.waiting);

      // Asking the server explicitly, because a worker only re-checks on its
      // own schedule; opening this card is a user saying "is there one?".
      void registration.update().catch(() => {});

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // `installed` with a controller already present means an update
          // that replaced something, rather than a first-ever install.
          if (installing.state === 'installed' && navigator.serviceWorker.controller && !cancelled) {
            setWaiting(installing);
          }
        });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const restart = useCallback(() => {
    if (!waiting) return;
    setRestarting(true);
    // The reload is driven by controllerchange rather than fired straight
    // after the message: the new worker has to finish activating first, and
    // reloading before it does just serves the old build again from cache.
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    waiting.postMessage('skip-waiting');
  }, [waiting]);

  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.label}>Version</Text>
        <Text style={styles.value}>{version}</Text>
      </View>

      {waiting ? (
        <>
          <Text style={styles.note}>A new version is ready.</Text>
          <Button
            title={restarting ? 'Restarting…' : 'Restart to update'}
            onPress={restart}
            disabled={restarting}
            style={styles.button}
          />
        </>
      ) : (
        <Text style={styles.note}>
          NutriAI updates itself in the background — you'll be offered a restart here when a new
          version is ready. The iOS and Android apps are installed separately.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...type.subheading, color: colors.text },
  value: { ...type.figureSmall, color: colors.textDim },
  note: { ...type.caption, fontSize: 11.5, color: colors.textDim, marginTop: 10, lineHeight: 16 },
  button: { marginTop: 12 },
});
