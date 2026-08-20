import { describe, expect, it } from 'vitest';
import { loadHandsFree, saveHandsFree } from './prefs';

describe('hands-free preference', () => {
  it('is off until it has been turned on', async () => {
    expect(await loadHandsFree()).toBe(false);
  });

  it('survives a round trip', async () => {
    await saveHandsFree(true);
    expect(await loadHandsFree()).toBe(true);
    await saveHandsFree(false);
    expect(await loadHandsFree()).toBe(false);
  });
});
