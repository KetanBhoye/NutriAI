import { describe, expect, it, vi } from 'vitest';

const setNotificationChannelAsync = vi.hoisted(() =>
  vi.fn(async (_id: string, _config: Record<string, unknown>) => undefined)
);

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
}));

vi.mock('expo-notifications', () => ({
  setNotificationChannelAsync: (id: string, config: Record<string, unknown>) =>
    setNotificationChannelAsync(id, config),
  AndroidImportance: { MAX: 5, DEFAULT: 3 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));

import { MEAL_CHANNEL_ID, UPDATE_CHANNEL_ID, channelFor, ensureChannels } from './channels';

/**
 * `ensured` is module state, and the module is imported once — so these run in
 * order against one shared history rather than resetting between tests. That
 * is also what makes the idempotency check meaningful.
 */
describe('ensureChannels on Android', () => {
  it('gives meal reminders the importance that produces a banner and a sound', async () => {
    await ensureChannels();

    const [id, config] = setNotificationChannelAsync.mock.calls[0]! as unknown as [
      string,
      { importance: number; sound: string },
    ];
    expect(id).toBe(MEAL_CHANNEL_ID);
    // The whole point: the default channel is IMPORTANCE_DEFAULT (3), which on
    // several vendor skins arrives silently and is missed.
    expect(config.importance).toBe(5);
    expect(config.sound).toBe('default');
  });

  it('keeps update notices quieter than reminders', () => {
    const [id, config] = setNotificationChannelAsync.mock.calls[1]! as unknown as [
      string,
      { importance: number },
    ];
    expect(id).toBe(UPDATE_CHANNEL_ID);
    expect(config.importance).toBe(3);
  });

  it('only creates them once, however often scheduling runs', async () => {
    await ensureChannels();
    await ensureChannels();

    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(2);
  });

  it('carries a version in the id, because Android ignores edits to a live channel', () => {
    // Changing importance later only takes effect under a new id — so if these
    // ever need different settings, the version has to move with them.
    expect(MEAL_CHANNEL_ID).toMatch(/-v\d+$/);
    expect(UPDATE_CHANNEL_ID).toMatch(/-v\d+$/);
  });

  it('attaches the channel to a notification', () => {
    expect(channelFor('x')).toEqual({ channelId: 'x' });
  });
});
