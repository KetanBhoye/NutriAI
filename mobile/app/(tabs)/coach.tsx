import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { aiApi, entriesApi } from '@/api';
import { writeCache } from '@/cache';
import { addDays, parseISODate, todayISO } from '@/dates';
import { emitEntriesChanged } from '@/entriesBus';
import { colors, fonts, radius, type } from '@/theme';
import { CoachHistoryTurn, FoodEntry } from '@/types';
import { THINKING_LABEL, describeStep } from '@/features/coach/progress';
import { LoggedCard } from '@/features/coach/LoggedCard';
import { MessageMenu, type MessageAction } from '@/features/coach/MessageMenu';
import { MicButton } from '@/features/coach/MicButton';
import { diffEntries, type LogDiff } from '@/features/coach/loggedItems';
import { joinDraft } from '@/features/coach/transcript';
import { loadHandsFree, saveHandsFree } from '@/features/coach/prefs';
import { isSpeechAvailable, speak, stopSpeaking } from '@/features/coach/speech';
import { useDictation } from '@/features/coach/useDictation';
import { NutriLoader } from '@/components/ui/NutriLoader';

const SUGGESTIONS = [
  '2 rotis, a bowl of dal and 3 boiled eggs for lunch',
  'How much protein do I have left today?',
  "What's my calorie count so far?",
  'I weighed 71.2 kg this morning',
];

const ACTIONS_THAT_CHANGE_LOG = new Set(['add_entry', 'update_entry', 'delete_entry']);

interface Bubble {
  id: string;
  from: 'user' | 'coach';
  text: string;
  at: number;
  changedLog?: boolean;
  logDate?: string;
  /** What the turn actually wrote, when we could read it back. */
  diff?: LogDiff;
  /** The turn failed; the message is kept so it can be sent again. */
  failed?: boolean;
  /** The user message this reply answered, so "Ask again" can re-run it. */
  prompt?: string;
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `b${idCounter}`;
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function Coach() {
  const today = todayISO();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeDate, setActiveDate] = useState(today);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [history, setHistory] = useState<CoachHistoryTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  /**
   * What the agent is doing right now, from the tool calls it streams back.
   * Null when idle. A coach turn that logs food takes 30-60s, and a spinner
   * that long is indistinguishable from a hang.
   */
  const [status, setStatus] = useState<string | null>(null);
  /** The message whose long-press menu is open. */
  const [menuFor, setMenuFor] = useState<Bubble | null>(null);
  /** The reply currently being read aloud, so its menu offers "Stop" instead. */
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  /** Dictation auto-sends and replies are spoken. Remembered between sessions. */
  const [handsFree, setHandsFree] = useState(false);
  const [copied, setCopied] = useState(false);
  /** False on a build whose native TTS module isn't linked — see speech.ts. */
  const [canSpeak] = useState(() => isSpeechAvailable());
  /**
   * The user tapped ↑ while dictating: send as soon as the final transcript
   * arrives, rather than dropping it into the composer for review.
   */
  const sendOnFinal = useRef(false);
  const listRef = useRef<FlatList<Bubble>>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    aiApi.getAiStatus().then((s) => setConfigured(s.configured));
    void loadHandsFree().then(setHandsFree);
  }, []);

  // Never leave the coach talking to an empty room.
  useEffect(() => () => stopSpeaking(), []);

  const isToday = activeDate === today;
  const labelFor = useCallback(
    (date: string) =>
      date === today
        ? 'Today'
        : date === addDays(today, -1)
          ? 'Yesterday'
          : parseISODate(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }),
    [today]
  );
  const dateLabel = labelFor(activeDate);

  const shiftDate = (days: number) => {
    const next = addDays(activeDate, days);
    if (next > today) return;
    setActiveDate(next);
  };

  const scrollToEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

  const readAloud = useCallback((bubble: Bubble) => {
    setSpeakingId(bubble.id);
    speak(bubble.text, () => setSpeakingId(null));
  }, []);

  const hush = useCallback(() => {
    stopSpeaking();
    setSpeakingId(null);
  }, []);

  /**
   * Re-reads the day either side of a turn that touched the log, so the reply
   * can show what was actually written (see features/coach/loggedItems.ts).
   *
   * The "before" read is fired in parallel with the chat request rather than
   * awaited before it — the turn is the slow part and must not wait on this —
   * and everything here is best-effort: no snapshot just means the older
   * one-line confirmation instead of the itemised card.
   */
  const readBackLog = async (
    date: string,
    before: Promise<{ entries: FoodEntry[] } | null>
  ): Promise<LogDiff | undefined> => {
    const after = await entriesApi.getEntries(date).catch(() => null);
    if (!after) return undefined;

    // Seed the cache the Today tab paints from, so it has the new rows before
    // its own re-fetch lands.
    void writeCache(`entries.${date}`, after);
    emitEntriesChanged(date);

    const previous = await before;
    if (!previous) return undefined;
    return diffEntries(previous.entries, after.entries) ?? undefined;
  };

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    const sentDate = activeDate;
    hush();
    setBubbles((prev) => [...prev, { id: nextId(), from: 'user', text: message, at: Date.now() }]);
    setInput('');
    setSending(true);
    setStatus(THINKING_LABEL);
    scrollToEnd();

    // Started now, resolved only if the turn turns out to have written
    // something — a snapshot of the day as it was before the coach touched it.
    const before = entriesApi.getEntries(sentDate).catch(() => null);

    try {
      const result = await aiApi.coachChatStreaming(
        { message, history, active_date: sentDate },
        (tools) => setStatus(describeStep(tools))
      );
      setHistory(result.history);
      const changed = result.actions.some((a) => ACTIONS_THAT_CHANGE_LOG.has(a));
      const diff = changed ? await readBackLog(sentDate, before) : undefined;
      const reply: Bubble = {
        id: nextId(),
        from: 'coach',
        text: result.reply,
        at: Date.now(),
        changedLog: changed,
        logDate: changed ? sentDate : undefined,
        diff,
        prompt: message,
      };
      setBubbles((prev) => [...prev, reply]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (handsFree && canSpeak) readAloud(reply);
    } catch {
      setBubbles((prev) => [
        ...prev,
        {
          id: nextId(),
          from: 'coach',
          text: 'Network error. Your message wasn’t sent.',
          at: Date.now(),
          failed: true,
          prompt: message,
        },
      ]);
    } finally {
      setSending(false);
      setStatus(null);
      scrollToEnd();
    }
  };

  /**
   * Dictation fills the composer; hands-free mode sends it.
   *
   * Reviewing before sending is the right default — recognisers mishear food
   * names constantly ("dal" as "doll"), and a wrong meal in the diary costs
   * more to undo than a re-read costs to avoid.
   */
  const dictation = useDictation(
    useCallback(
      (finalText: string) => {
        const asked = sendOnFinal.current;
        sendOnFinal.current = false;
        // `send` refuses while a turn is in flight, which would swallow the
        // sentence silently — park it in the composer instead of losing it.
        if ((handsFree || asked) && !sending) {
          void send(finalText);
          return;
        }
        setInput((prev) => joinDraft(prev, finalText));
      },
      // The state `send` reads, rather than `send` itself (it's redefined every
      // render). The hook keeps this callback in a ref, so a change here
      // doesn't re-register the native listener — it just keeps what fires on
      // a final transcript in step with the conversation.
      [handsFree, activeDate, history, sending]
    )
  );

  const toggleHandsFree = () => {
    const next = !handsFree;
    setHandsFree(next);
    void saveHandsFree(next);
    if (!next) hush();
    void Haptics.selectionAsync();
  };

  const openLog = (logDate?: string) => {
    router.push({ pathname: '/(tabs)', params: !logDate || logDate === today ? {} : { date: logDate } });
  };

  const copyMessage = async (bubble: Bubble) => {
    await Clipboard.setStringAsync(bubble.text);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const copyThread = async () => {
    const transcript = bubbles.map((b) => `${b.from === 'user' ? 'You' : 'Coach'}: ${b.text}`).join('\n\n');
    await Clipboard.setStringAsync(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const newChat = () => {
    if (bubbles.length === 0) return;
    Alert.alert('Start a new chat?', 'This clears the conversation. Nothing in your log is affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New chat',
        style: 'destructive',
        onPress: () => {
          hush();
          setBubbles([]);
          setHistory([]);
        },
      },
    ]);
  };

  /** Long-press actions for one message. */
  const actionsFor = (bubble: Bubble): MessageAction[] => {
    const actions: MessageAction[] = [
      { key: 'copy', label: 'Copy text', icon: 'copy', onPress: () => void copyMessage(bubble) },
    ];

    if (canSpeak && speakingId === bubble.id) {
      actions.push({ key: 'hush', label: 'Stop reading', icon: 'volume-x', onPress: hush });
    } else if (canSpeak) {
      actions.push({ key: 'speak', label: 'Read aloud', icon: 'volume-2', onPress: () => readAloud(bubble) });
    }

    if (bubble.from === 'user') {
      actions.push({
        key: 'edit',
        label: 'Edit and resend',
        icon: 'edit-3',
        onPress: () => setInput(bubble.text),
      });
      actions.push({ key: 'again', label: 'Send again', icon: 'corner-up-right', onPress: () => void send(bubble.text) });
    } else if (bubble.prompt) {
      actions.push({
        key: 'regen',
        label: bubble.failed ? 'Try again' : 'Ask again',
        icon: 'refresh-cw',
        onPress: () => void send(bubble.prompt),
      });
    }

    if (bubbles.length > 1) {
      actions.push({ key: 'thread', label: 'Copy whole conversation', icon: 'clipboard', onPress: () => void copyThread() });
    }
    return actions;
  };

  // The same join the finished transcript goes through, so what you watch
  // being typed is exactly what lands in the field.
  const composerValue = dictation.listening ? joinDraft(input, dictation.transcript) : input;
  const canSend = Boolean(composerValue.trim()) && !sending;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headTitle}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>🥗</Text>
            </View>
            <View>
              <Text style={styles.headTitleText}>Coach</Text>
              <Text style={styles.headSub}>
                {dictation.listening ? 'Listening…' : `Acting on ${dateLabel.toLowerCase()}`}
              </Text>
            </View>
          </View>
          <View style={styles.headActions}>
            {dictation.available ? (
              <Pressable
                testID="coach-hands-free"
                onPress={toggleHandsFree}
                hitSlop={8}
                accessibilityRole="switch"
                accessibilityState={{ checked: handsFree }}
                accessibilityLabel="Hands-free voice chat"
                style={[styles.iconBtn, handsFree && styles.iconBtnOn]}
              >
                <Feather
                  name={handsFree ? 'volume-2' : 'volume-x'}
                  size={16}
                  color={handsFree ? colors.onAccent : colors.textDim}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={newChat}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Start a new chat"
              style={[styles.iconBtn, bubbles.length === 0 && styles.iconBtnDisabled]}
            >
              <Feather name="edit" size={16} color={colors.textDim} />
            </Pressable>
          </View>
        </View>

        <View style={styles.dateNav}>
          <Pressable onPress={() => shiftDate(-1)} hitSlop={8} style={styles.navBtn}>
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <View style={[styles.datePill, !isToday && styles.datePillPast]}>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
          </View>
          <Pressable onPress={() => shiftDate(1)} hitSlop={8} disabled={isToday} style={styles.navBtn}>
            <Text style={[styles.navBtnText, isToday && styles.navBtnDisabled]}>›</Text>
          </Pressable>
        </View>
      </View>

      {configured === false ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            The Coach isn't switched on for this server yet — it needs the AI provider configured. Until then,
            log foods from the Today tab.
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          // 0 because the SafeAreaView already accounts for the top inset and
          // there is no navigator header to offset against.
          keyboardVerticalOffset={0}
        >
          {bubbles.length === 0 ? (
            // Scrollable: with the keyboard up the available height shrinks,
            // and a fixed View just clips the starter chips out of reach.
            <ScrollView
              contentContainerStyle={styles.empty}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.emptyAvatar}>
                <Text style={styles.avatarText}>🥗</Text>
              </View>
              <Text style={styles.emptyTitle}>Hey — I'm your coach</Text>
              <Text style={styles.emptySub}>
                Tell me what you ate, ask how your day's going, or update your weight. Type it or tap the mic.
              </Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} style={styles.chip} onPress={() => send(s)}>
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : (
            <FlatList
              ref={listRef}
              data={bubbles}
              keyExtractor={(b) => b.id}
              contentContainerStyle={styles.thread}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              renderItem={({ item }) => (
                <View style={[styles.bubbleRow, item.from === 'user' && styles.bubbleRowUser]}>
                  {item.from === 'coach' ? (
                    <View style={styles.miniAvatar}>
                      <Text style={styles.miniAvatarText}>🥗</Text>
                    </View>
                  ) : null}
                  <View style={styles.bubbleColumn}>
                    <Pressable
                      onLongPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setMenuFor(item);
                      }}
                      delayLongPress={300}
                      style={[
                        styles.bubble,
                        item.from === 'user' ? styles.bubbleUser : styles.bubbleCoach,
                        item.failed && styles.bubbleFailed,
                      ]}
                    >
                      {/* Selectable as well as long-pressable: the menu covers
                          "all of it", selection covers "just this number". */}
                      <Text
                        selectable
                        style={[styles.bubbleText, item.from === 'user' && styles.bubbleTextUser]}
                      >
                        {item.text}
                      </Text>

                      {item.diff ? (
                        <LoggedCard
                          diff={item.diff}
                          dateLabel={labelFor(item.logDate ?? today)}
                          onOpen={() => openLog(item.logDate)}
                        />
                      ) : item.changedLog ? (
                        <Pressable testID="coach-logged-card" onPress={() => openLog(item.logDate)}>
                          <Text style={styles.changed}>
                            ✓ updated your log — view {!item.logDate || item.logDate === today ? 'Today' : item.logDate}
                          </Text>
                        </Pressable>
                      ) : null}

                      {item.failed && item.prompt ? (
                        <Pressable onPress={() => void send(item.prompt)} style={styles.retry}>
                          <Feather name="refresh-cw" size={12} color={colors.danger} />
                          <Text style={styles.retryText}>Tap to retry</Text>
                        </Pressable>
                      ) : null}
                    </Pressable>

                    <View style={[styles.metaRow, item.from === 'user' && styles.metaRowUser]}>
                      {speakingId === item.id ? (
                        <Feather name="volume-2" size={11} color={colors.accent} />
                      ) : null}
                      <Text style={styles.metaText}>{clockTime(item.at)}</Text>
                    </View>
                  </View>
                </View>
              )}
              ListFooterComponent={
                sending ? (
                  <View style={styles.bubbleRow}>
                    <View style={styles.miniAvatar}>
                      <Text style={styles.miniAvatarText}>🥗</Text>
                    </View>
                    <View style={[styles.bubble, styles.bubbleCoach, styles.bubbleWorking]}>
                      <NutriLoader size={20} bare />
                      {status ? <Text style={styles.working}>{status}…</Text> : null}
                    </View>
                  </View>
                ) : null
              }
            />
          )}

          {copied ? (
            <View style={styles.toast}>
              <Feather name="check" size={13} color={colors.accent} />
              <Text style={styles.toastText}>Copied</Text>
            </View>
          ) : null}

          {dictation.error ? (
            <Pressable onPress={dictation.clearError} style={styles.micError}>
              <Feather name="mic-off" size={13} color={colors.danger} />
              <Text style={styles.micErrorText}>{dictation.error}</Text>
            </Pressable>
          ) : null}

          <View style={styles.composerWrap}>
            {/* The composer is multiline, so Return inserts a newline and
                there is otherwise no way to put the keyboard away. */}
            {keyboardUp ? (
              <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.dismissRow}>
                <Feather name="chevron-down" size={16} color={colors.textDim} />
                <Text style={styles.dismissText}>Hide keyboard</Text>
              </Pressable>
            ) : null}
            {dictation.listening ? (
              <View style={styles.listeningRow}>
                <View style={styles.listeningDot} />
                <Text style={styles.listeningText}>
                  {handsFree ? 'Listening — I’ll send it when you stop' : 'Listening — tap ■ when you’re done'}
                </Text>
              </View>
            ) : null}
            <View style={[styles.composerPill, dictation.listening && styles.composerPillLive]}>
              {dictation.available ? (
                <MicButton
                  listening={dictation.listening}
                  level={dictation.level}
                  disabled={sending}
                  onPress={() => (dictation.listening ? dictation.stop() : void dictation.start())}
                />
              ) : null}
              <TextInput
                // Named for the E2E flow: the send control is an arrow glyph
                // and the input has only a placeholder, neither of which is a
                // selector worth depending on.
                testID="coach-input"
                style={styles.composerInput}
                placeholder={dictation.listening ? 'Go ahead, I’m listening…' : 'Message your coach…'}
                placeholderTextColor={colors.textDim}
                value={composerValue}
                onChangeText={setInput}
                // Typing over live dictation would fight the recogniser for
                // the same field; the mic owns it until the user stops.
                editable={!sending && !dictation.listening}
                multiline
                onSubmitEditing={() => send()}
              />
              <Pressable
                testID="coach-send"
                onPress={() => {
                  if (!dictation.listening) {
                    void send();
                    return;
                  }
                  // Mid-dictation, ↑ means "that's my message" — stop, then
                  // send the final transcript rather than parking it in the
                  // composer for a second tap.
                  sendOnFinal.current = true;
                  dictation.stop();
                }}
                disabled={!canSend && !dictation.listening}
                style={[styles.sendBtn, !canSend && !dictation.listening && styles.sendBtnDisabled]}
              >
                <Text style={styles.sendBtnText}>↑</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      <MessageMenu
        visible={menuFor !== null}
        preview={menuFor?.text ?? ''}
        actions={menuFor ? actionsFor(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  iconBtnDisabled: { opacity: 0.4 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18 },
  headTitleText: { color: colors.text, fontSize: 17, fontFamily: fonts.bold },
  headSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  navBtn: { width: 30, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { color: colors.textDim, fontSize: 20 },
  navBtnDisabled: { opacity: 0.25 },
  datePill: { alignItems: 'center', minWidth: 100, paddingVertical: 3, borderRadius: 9 },
  datePillPast: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  dateLabel: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
  notice: { margin: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: 16 },
  noticeText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  emptyAvatar: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { color: colors.text, fontSize: 19, fontFamily: fonts.bold, marginBottom: 6 },
  emptySub: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginBottom: 18, maxWidth: 300 },
  chips: { width: '100%', maxWidth: 340, gap: 8 },
  chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 13 },
  chipText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  thread: { padding: 16, flexGrow: 1, justifyContent: 'flex-end' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  bubbleRowUser: { flexDirection: 'row-reverse' },
  bubbleColumn: { maxWidth: '86%' },
  miniAvatar: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: { fontSize: 13 },
  bubble: { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleUser: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
  bubbleWorking: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  working: { ...type.caption, color: colors.textDim, fontSize: 13 },
  bubbleCoach: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 },
  bubbleFailed: { borderColor: colors.danger },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: colors.onAccent },
  changed: { color: colors.accent, fontSize: 13, fontFamily: fonts.bold, marginTop: 8 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  retryText: { ...type.caption, fontSize: 12.5, fontFamily: fonts.semibold, color: colors.danger },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, paddingHorizontal: 4 },
  metaRowUser: { justifyContent: 'flex-end' },
  metaText: { ...type.caption, fontSize: 10.5, lineHeight: 13, color: colors.textDim },
  toast: {
    position: 'absolute',
    bottom: 96,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toastText: { ...type.caption, fontFamily: fonts.semibold, color: colors.text },
  micError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius - 2,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  micErrorText: { ...type.caption, fontSize: 12.5, color: colors.text, flex: 1 },
  composerWrap: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  dismissRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingBottom: 8 },
  dismissText: { ...type.caption, fontSize: 12, color: colors.textDim },
  listeningRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 6 },
  listeningDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  listeningText: { ...type.caption, fontSize: 12, color: colors.accent },
  composerPill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 5,
  },
  composerPillLive: { borderColor: colors.accent },
  composerInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.surface },
  sendBtnText: { color: colors.onAccent, fontSize: 18, fontFamily: fonts.extrabold },
});
