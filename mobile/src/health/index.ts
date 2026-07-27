import { Platform } from 'react-native';
import { HealthProvider } from './types';

export * from './types';

/**
 * The platform's health store: Apple Health on iOS, Health Connect on Android.
 *
 * Each provider pulls in a native module that ONLY exists in its own platform's
 * binary (`react-native-health` on iOS, `react-native-health-connect` on
 * Android). Loading the wrong one throws at import time
 * (`TurboModuleRegistry.getEnforcing('HealthConnect')` on iOS), so we require
 * only the module for the current platform rather than importing both eagerly.
 */
export const health: HealthProvider =
  Platform.OS === 'ios'
    ? (require('./healthkit') as typeof import('./healthkit')).healthKitProvider
    : (require('./healthConnect') as typeof import('./healthConnect')).healthConnectProvider;
