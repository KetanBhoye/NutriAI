import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Permission handling on Android, which is where the real-world failures are.
 *
 * The device that prompted this: an iQOO running OriginOS, where connecting
 * reported "permission was not granted" — in green, in the same slot as
 * "Synced ✓". Two separate bugs; this file covers the logic half.
 */

const hc = vi.hoisted(() => ({
  initialize: vi.fn(async () => true),
  getSdkStatus: vi.fn(async () => 3),
  requestPermission: vi.fn(async () => [] as unknown[]),
  getGrantedPermissions: vi.fn(async () => [] as unknown[]),
  openHealthConnectSettings: vi.fn(async () => undefined),
  readRecords: vi.fn(async () => ({ records: [] })),
  aggregateRecord: vi.fn(async () => ({})),
  SdkAvailabilityStatus: {
    SDK_AVAILABLE: 3,
    SDK_UNAVAILABLE: 1,
    SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
  },
}));

vi.mock('react-native-health-connect', () => hc);

import { healthConnectProvider as provider } from './healthConnect';

const PERMS = [{ accessType: 'read', recordType: 'Steps' }];

beforeEach(() => {
  hc.requestPermission.mockReset().mockResolvedValue([]);
  hc.getGrantedPermissions.mockReset().mockResolvedValue([]);
  hc.getSdkStatus.mockReset().mockResolvedValue(3);
});

describe('requestPermissions', () => {
  it('does not prompt when access is already held', async () => {
    hc.getGrantedPermissions.mockResolvedValue(PERMS);

    expect(await provider.requestPermissions()).toBe(true);
    // Re-prompting a user who already said yes is how you get a "no" the
    // second time, and Android remembers it.
    expect(hc.requestPermission).not.toHaveBeenCalled();
  });

  it('trusts what is granted over what the request returned', async () => {
    // The iQOO case: the user taps Allow, the grant lands, and
    // requestPermission still resolves with an empty array. Believing it
    // reported a refusal the user could see was false.
    hc.requestPermission.mockResolvedValue([]);
    hc.getGrantedPermissions.mockResolvedValueOnce([]).mockResolvedValueOnce(PERMS);

    expect(await provider.requestPermissions()).toBe(true);
  });

  it('reports a genuine refusal as a refusal', async () => {
    hc.requestPermission.mockResolvedValue([]);
    hc.getGrantedPermissions.mockResolvedValue([]);

    expect(await provider.requestPermissions()).toBe(false);
  });

  it('still checks the granted set when the request itself throws', async () => {
    // Android stops showing the dialog after repeated denials, and some ROMs
    // surface that as a throw rather than an empty result.
    hc.requestPermission.mockRejectedValue(new Error('no activity found'));
    hc.getGrantedPermissions.mockResolvedValueOnce([]).mockResolvedValueOnce(PERMS);

    expect(await provider.requestPermissions()).toBe(true);
  });
});

describe('availability', () => {
  it('separates "needs updating" from "not available"', async () => {
    // Different advice: one means install it, the other means update it.
    // Telling someone to install an app they already have wastes their time.
    hc.getSdkStatus.mockResolvedValue(2);
    expect(await provider.availability!()).toBe('needs-update');

    hc.getSdkStatus.mockResolvedValue(1);
    expect(await provider.availability!()).toBe('unavailable');

    hc.getSdkStatus.mockResolvedValue(3);
    expect(await provider.availability!()).toBe('available');
  });

  it('treats a throwing SDK as unavailable rather than crashing the tab', async () => {
    hc.getSdkStatus.mockRejectedValue(new Error('no provider'));

    expect(await provider.availability!()).toBe('unavailable');
    expect(await provider.isAvailable()).toBe(false);
  });
});

describe('hasPermissions', () => {
  it('is false when nothing is granted, and survives a throw', async () => {
    expect(await provider.hasPermissions!()).toBe(false);

    hc.getGrantedPermissions.mockRejectedValue(new Error('not initialised'));
    expect(await provider.hasPermissions!()).toBe(false);
  });
});
