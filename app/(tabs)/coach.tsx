import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { aiApi } from '@/api';
import { addDays, parseISODate, todayISO } from '@/dates';
import { colors, fonts, radius } from '@/theme';
import { CoachHistoryTurn } from '@/types';

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
  changedLog?: boolean;
  logDate?: string;
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `b${idCounter}`;
}

export default function Coach() {
  const today = todayISO();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeDate, setActiveDate] = useState(today);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [history, setHistory] = useState<CoachHistoryTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    aiApi.getAiStatus().then((s) => setConfigured(s.configured));
  }, []);

  const isToday = activeDate === today;
  const dateLabel = isToday
    ? 'Today'
    : activeDate === addDays(today, -1)
      ? 'Yesterday'
      : parseISODate(activeDate).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  const shiftDate = (days: number) => {
    const next = addDays(activeDate, days);
    if (next > today) return;
    setActiveDate(next);
  };

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    const sentDate = activeDate;
    setBubbles((prev) => [...prev, { id: nextId(), from: 'user', text: message }]);
    setInput('');
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const result = await aiApi.coachChat({ message, history, active_date: sentDate });
      setHistory(result.history);
      const changed = result.actions.some((a) => ACTIONS_THAT_CHANGE_LOG.has(a));
      setBubbles((prev) => [
        ...prev,
        { id: nextId(), from: 'coach', text: result.reply, changedLog: changed, logDate: changed ? sentDate : undefined },
      ]);
    } catch {
      setBubbles((prev) => [...prev, { id: nextId(), from: 'coach', text: 'Network error. Try again in a moment.' }]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const openLog = (logDate?: string) => {
    router.push({ pathname: '/(tabs)', params: !logDate || logDate === today ? {} : { date: logDate } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headTitle}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>🥗</Text>
          </View>
          <View>
            <Text style={styles.headTitleText}>Coach</Text>
            <Text style={styles.headSub}>Acting on {dateLabel.toLowerCase()}</Text>
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
            <View style={styles.empty}>
              <View style={styles.emptyAvatar}>
                <Text style={styles.avatarText}>🥗</Text>
              </View>
              <Text style={styles.emptyTitle}>Hey — I'm your coach</Text>
              <Text style={styles.emptySub}>
                Tell me what you ate, ask how your day's going, or update your weight. Try one:
              </Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} style={styles.chip} onPress={() => send(s)}>
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
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
                  <View style={[styles.bubble, item.from === 'user' ? styles.bubbleUser : styles.bubbleCoach]}>
                    <Text style={[styles.bubbleText, item.from === 'user' && styles.bubbleTextUser]}>{item.text}</Text>
                    {item.changedLog ? (
                      <Pressable onPress={() => openLog(item.logDate)}>
                        <Text style={styles.changed}>
                          ✓ updated your log — view {!item.logDate || item.logDate === today ? 'Today' : item.logDate}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )}
              ListFooterComponent={
                sending ? (
                  <View style={styles.bubbleRow}>
                    <View style={styles.miniAvatar}>
                      <Text style={styles.miniAvatarText}>🥗</Text>
                    </View>
                    <View style={[styles.bubble, styles.bubbleCoach]}>
                      <ActivityIndicator color={colors.textDim} size="small" />
                    </View>
                  </View>
                ) : null
              }
            />
          )}

          <View style={styles.composerWrap}>
            <View style={styles.composerPill}>
              <TextInput
                style={styles.composerInput}
                placeholder="Message your coach…"
                placeholderTextColor={colors.textDim}
                value={input}
                onChangeText={setInput}
                editable={!sending}
                multiline
                onSubmitEditing={() => send()}
              />
              <Pressable
                onPress={() => send()}
                disabled={sending || !input.trim()}
                style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnDisabled]}
              >
                <Text style={styles.sendBtnText}>↑</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  navBtn: { width: 30, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { color: colors.textDim, fontSize: 20 },
  navBtnDisabled: { opacity: 0.25 },
  datePill: { alignItems: 'center', minWidth: 68, paddingVertical: 3, borderRadius: 9 },
  datePillPast: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  dateLabel: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
  notice: { margin: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: 16 },
  noticeText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
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
  bubble: { maxWidth: '82%', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleUser: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
  bubbleCoach: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: colors.onAccent },
  changed: { color: colors.accent, fontSize: 13, fontFamily: fonts.bold, marginTop: 8 },
  composerWrap: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
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
