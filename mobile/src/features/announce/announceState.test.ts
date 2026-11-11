import { describe, expect, it } from 'vitest';
import { dismissedAnnouncement, rememberAnnouncementDismissal } from './announceState';

describe('the announcement dismissal', () => {
  it('remembers the announcement it was said about, and only that one', async () => {
    await rememberAnnouncementDismissal('a1');
    expect(await dismissedAnnouncement()).toBe('a1');
    // A new message has a new id, so it is not silenced by the old dismissal.
    expect(await dismissedAnnouncement()).not.toBe('a2');
  });
});
