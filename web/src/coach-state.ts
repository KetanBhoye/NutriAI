import { ref } from 'vue';
import { todayISO } from './dates';

/**
 * Coach conversation state, held at module scope so it survives tab switches.
 *
 * Vue Router doesn't keep-alive views, so CoachView unmounts every time you
 * navigate away — local refs would reset the chat to empty. Keeping the bubbles,
 * raw Gemini history and the active date here preserves the conversation for the
 * whole session (it clears on a full app reload / new launch).
 */
export interface CoachBubble {
  id: string;
  from: 'user' | 'coach';
  text: string;
  changedLog?: boolean;
  logDate?: string;
}

export type CoachHistoryTurn = { role: 'user' | 'model'; parts: unknown[] };

export const coachBubbles = ref<CoachBubble[]>([]);
export const coachHistory = ref<CoachHistoryTurn[]>([]);
export const coachActiveDate = ref<string>(todayISO());
