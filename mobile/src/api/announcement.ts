import { api } from './client';

export interface Announcement {
  id: string;
  title: string;
  body: string;
}

/**
 * The one message the server wants every user to see, or null.
 *
 * Never throws: a server too old to have the route, a dropped connection and
 * "nothing to say" all mean the same thing to the screen asking.
 */
export function getAnnouncement(): Promise<Announcement | null> {
  return api<{ announcement: Announcement | null }>('/api/announcement', { timeoutMs: 8000 })
    .then((r) => r.announcement ?? null)
    .catch(() => null);
}
