import { describe, expect, it } from 'vitest';
import { THINKING_LABEL, describeStep } from './progress';

describe('describeStep', () => {
  it('says what the user asked about, not the tool that does it', () => {
    expect(describeStep(['lookup_nutrition'])).toBe('Looking up the nutrition');
    expect(describeStep(['add_entry'])).toBe('Adding it to your log');
    expect(describeStep(['compare_progress'])).toBe('Comparing your progress');
  });

  it('counts a repeated tool instead of repeating the label', () => {
    // A three-item meal is three add_entry calls in one step.
    expect(describeStep(['add_entry', 'add_entry', 'add_entry'])).toBe('Adding it to your log (3)');
  });

  it('joins genuinely different tools', () => {
    expect(describeStep(['lookup_nutrition', 'list_entries'])).toBe(
      'Looking up the nutrition · Reading your day'
    );
  });

  it('stops at two, because a chat bubble is not a log viewer', () => {
    const label = describeStep(['lookup_nutrition', 'list_entries', 'get_profile', 'add_entry']);
    expect(label.split('·')).toHaveLength(2);
  });

  it('never leaks an internal tool name into the UI', () => {
    // A tool added server-side that this build has no label for.
    expect(describeStep(['some_future_tool'])).toBe(THINKING_LABEL);
    expect(describeStep(['some_future_tool'])).not.toContain('_');
  });

  it('falls back to thinking when a step reports nothing', () => {
    expect(describeStep([])).toBe(THINKING_LABEL);
    expect(describeStep([''])).toBe(THINKING_LABEL);
  });
});
