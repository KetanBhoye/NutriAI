import { describe, expect, it } from 'vitest';
import { joinDraft, mergeTranscript } from './transcript';

describe('mergeTranscript', () => {
  it('takes the first result as-is', () => {
    expect(mergeTranscript('', 'two rotis')).toBe('two rotis');
  });

  it('ignores an empty result', () => {
    expect(mergeTranscript('two rotis', '')).toBe('two rotis');
    expect(mergeTranscript('two rotis', '   ')).toBe('two rotis');
  });

  describe("iOS, where every result is the whole session so far", () => {
    it('replaces as the sentence grows', () => {
      let text = '';
      for (const result of ['What', 'What are', 'What are you', 'What are you doing?']) {
        text = mergeTranscript(text, result);
      }
      expect(text).toBe('What are you doing?');
    });

    it('does not duplicate when the same final arrives again', () => {
      const text = mergeTranscript('What are you doing?', 'What are you doing?');
      expect(text).toBe('What are you doing?');
    });

    it('survives the same final ten times over — the bug this exists for', () => {
      let text = 'What are you doing?';
      for (let i = 0; i < 10; i += 1) text = mergeTranscript(text, 'What are you doing?');
      expect(text).toBe('What are you doing?');
    });

    it('treats a punctuated repeat of unpunctuated text as the same speech', () => {
      expect(mergeTranscript('what are you doing', 'What are you doing?')).toBe('What are you doing?');
    });
  });

  describe('Android, where each result is one segment', () => {
    it('joins successive segments', () => {
      let text = '';
      for (const segment of ['Two rotis', 'and a bowl of dal', 'for lunch']) {
        text = mergeTranscript(text, segment);
      }
      expect(text).toBe('Two rotis and a bowl of dal for lunch');
    });

    it('ignores a repeat of the segment just committed', () => {
      const text = mergeTranscript('Two rotis and a bowl of dal', 'and a bowl of dal');
      expect(text).toBe('Two rotis and a bowl of dal');
    });

    it('keeps a new segment that happens to repeat an earlier word', () => {
      // Only a repeat of the *tail* is treated as an echo. "dal" here follows
      // "dal and rice", so it is new speech and is kept.
      expect(mergeTranscript('dal and rice', 'dal')).toBe('dal and rice dal');
      expect(mergeTranscript('rice and dal', 'and eggs')).toBe('rice and dal and eggs');
    });

    it('drops an echo of the tail, which is what a repeated segment looks like', () => {
      expect(mergeTranscript('two rotis and dal', 'and dal')).toBe('two rotis and dal');
    });
  });

  it('tidies the whitespace recognisers pad segments with', () => {
    expect(mergeTranscript('  two   rotis ', '  and dal  ')).toBe('two rotis and dal');
  });

  it('is idempotent — merging the same result twice changes nothing', () => {
    const once = mergeTranscript('two rotis', 'and dal');
    expect(mergeTranscript(once, 'and dal')).toBe(once);
  });

  it('handles a mixed stream: cumulative growth, then a new segment', () => {
    let text = '';
    text = mergeTranscript(text, 'I ate');
    text = mergeTranscript(text, 'I ate two rotis');
    text = mergeTranscript(text, 'I ate two rotis'); // repeat
    text = mergeTranscript(text, 'and three eggs'); // new segment
    expect(text).toBe('I ate two rotis and three eggs');
  });
});

describe('joinDraft', () => {
  it('puts one space between typed and spoken text', () => {
    expect(joinDraft('I ate', 'two rotis')).toBe('I ate two rotis');
  });

  it('is just the spoken text when nothing was typed', () => {
    expect(joinDraft('', 'two rotis')).toBe('two rotis');
    expect(joinDraft('   ', 'two rotis')).toBe('two rotis');
  });

  it('is just the typed text when nothing was said', () => {
    expect(joinDraft('I ate', '')).toBe('I ate');
  });

  it('leaves a deliberate repetition alone — typed words are not guessed at', () => {
    expect(joinDraft('dal', 'dal')).toBe('dal dal');
  });

  it('is empty when there is nothing at all', () => {
    expect(joinDraft('', '')).toBe('');
  });
});
