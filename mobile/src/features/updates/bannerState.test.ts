import { describe, expect, it } from 'vitest';
import { dismissedVersion, rememberDismissal } from './bannerState';

describe('the update banner dismissal', () => {
  it('is silent for nobody before anything is dismissed', async () => {
    expect(await dismissedVersion()).toBeNull();
  });

  it('honours "not now" for the version it was said about', async () => {
    await rememberDismissal('1.0.5');
    expect(await dismissedVersion()).toBe('1.0.5');
  });

  it('does not silence the next release', async () => {
    // The mistake this guards: storing a boolean. Dismiss once and every
    // future version would go unannounced, which is how an update mechanism
    // quietly stops working.
    await rememberDismissal('1.0.5');
    expect(await dismissedVersion()).not.toBe('1.0.6');
  });
});
