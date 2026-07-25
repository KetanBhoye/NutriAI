import { ref } from 'vue';

/**
 * App-install state, captured once at startup and shared by the top banner and
 * the Profile "Install app" card.
 *
 *  - Android/Chrome fire `beforeinstallprompt`; we stash it and expose a button.
 *  - iOS Safari never fires it and has no programmatic install, so we detect iOS
 *    and show manual "Add to Home Screen" steps instead.
 *  - Once installed (standalone display mode) both surfaces show "installed".
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;

export const canInstall = ref(false); // Android/Chrome native prompt available
export const isInstalled = ref(false);

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** Wire up the listeners. Call once, before mounting the app. */
export function initInstall(): void {
  isInstalled.value = isStandalone();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    canInstall.value = true;
  });

  window.addEventListener('appinstalled', () => {
    isInstalled.value = true;
    canInstall.value = false;
    deferred = null;
  });
}

/** Fires the native Android/Chrome install prompt. Returns the outcome. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  await deferred.prompt();
  const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  deferred = null;
  canInstall.value = false;
  return choice.outcome;
}
