import { describe, expect, it } from 'vitest';
import { compareVersions, formatSize, isUpdateAvailable } from './version';

describe('compareVersions', () => {
  it('orders by number, not by string', () => {
    // The bug this exists to prevent: '1.0.10' sorts before '1.0.9'
    // lexicographically, so the tenth patch would never be offered.
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('treats equal versions as equal, with or without the v prefix', () => {
    expect(compareVersions('1.0.1', '1.0.1')).toBe(0);
    expect(compareVersions('v1.0.1', '1.0.1')).toBe(0);
  });

  it('gives up on anything that is not three numbers', () => {
    expect(compareVersions('1.0', '1.0.1')).toBeNull();
    expect(compareVersions('1.0.1-beta', '1.0.1')).toBeNull();
    expect(compareVersions('', '1.0.1')).toBeNull();
  });
});

describe('isUpdateAvailable', () => {
  it('offers a newer version', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.1')).toBe(true);
    expect(isUpdateAvailable('1.0.0', '2.0.0')).toBe(true);
  });

  it('stays quiet when already up to date', () => {
    expect(isUpdateAvailable('1.0.1', '1.0.1')).toBe(false);
  });

  it('never offers a downgrade', () => {
    // Routine while developing: the device runs a build ahead of the last
    // published release. Android refuses to install an older versionCode, so
    // the button would do nothing at all.
    expect(isUpdateAvailable('1.1.0', '1.0.1')).toBe(false);
  });

  it('stays quiet when the server has no release to offer', () => {
    expect(isUpdateAvailable('1.0.0', null)).toBe(false);
    expect(isUpdateAvailable('1.0.0', undefined)).toBe(false);
    expect(isUpdateAvailable('1.0.0', '')).toBe(false);
  });

  it('stays quiet rather than guessing at an unparseable version', () => {
    expect(isUpdateAvailable('1.0.0', 'nightly')).toBe(false);
    expect(isUpdateAvailable('unknown', '1.0.1')).toBe(false);
  });
});

describe('formatSize', () => {
  it('rounds to whole megabytes', () => {
    expect(formatSize(90_000_000)).toBe('86 MB');
  });

  it('switches to GB when the number stops being readable', () => {
    expect(formatSize(2_000_000_000)).toBe('1.9 GB');
  });

  it('returns null when the size is unknown, so the UI can omit it', () => {
    expect(formatSize(null)).toBeNull();
    expect(formatSize(0)).toBeNull();
  });
});
