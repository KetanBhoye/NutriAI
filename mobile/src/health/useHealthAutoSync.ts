import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { autoSyncHealth } from './autoSync';

/**
 * Syncs health data on launch and each time the app returns to the
 * foreground. Mounted once, inside the authenticated part of the tree — there
 * is no point syncing before there's a session to POST against.
 */
export function useHealthAutoSync(enabled: boolean): void {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!enabled) return;

    void autoSyncHealth();

    const sub = AppState.addEventListener('change', (next) => {
      const cameToForeground = appState.current.match(/inactive|background/) && next === 'active';
      appState.current = next;
      if (cameToForeground) void autoSyncHealth();
    });

    return () => sub.remove();
  }, [enabled]);
}
