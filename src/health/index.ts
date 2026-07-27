import { Platform } from 'react-native';
import { HealthProvider } from './types';
import { healthKitProvider } from './healthkit';
import { healthConnectProvider } from './healthConnect';

export * from './types';

/** The platform's health store: Apple Health on iOS, Health Connect on Android. */
export const health: HealthProvider =
  Platform.OS === 'ios' ? healthKitProvider : healthConnectProvider;
