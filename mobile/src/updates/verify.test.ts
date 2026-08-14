import { describe, expect, it } from 'vitest';
import { describeDownloadProblem, describeSpaceProblem } from './verify';

const MB = 1024 * 1024;

/** Base64 of a real APK's first bytes (`PK\x03\x04...`). */
const APK_HEAD = 'UEsDBBQACAgI';
/** What an HTML error page looks like here: base64 of `<!DOCTYPE`. */
const HTML_HEAD = 'PCFET0NUWVBF';

describe('describeDownloadProblem', () => {
  it('passes a real APK', () => {
    expect(describeDownloadProblem({ status: 200, size: 90_000_000, headBase64: APK_HEAD })).toBeNull();
  });

  it('catches an error page served with a 200', () => {
    // The realistic failure: /download redirects somewhere that answers
    // cheerfully with HTML. Android's only feedback would be "App not
    // installed", which names nothing.
    const problem = describeDownloadProblem({ status: 200, size: 4_000_000, headBase64: HTML_HEAD });

    expect(problem).toMatch(/wasn't an app file/);
  });

  it('catches a truncated download', () => {
    expect(describeDownloadProblem({ status: 200, size: 12_000, headBase64: APK_HEAD })).toMatch(
      /didn't come through/
    );
  });

  it('reports the status when the server refused', () => {
    expect(describeDownloadProblem({ status: 404, size: 0, headBase64: '' })).toMatch(/404/);
    expect(describeDownloadProblem({ status: 503, size: 0, headBase64: '' })).toMatch(/503/);
  });
});

describe('describeSpaceProblem', () => {
  it('allows an update with room to spare', () => {
    expect(describeSpaceProblem(86 * MB, 4000 * MB)).toBeNull();
  });

  it('names both numbers, so the user knows how much to clear', () => {
    const problem = describeSpaceProblem(144 * MB, 200 * MB);

    expect(problem).toMatch(/Not enough free space/);
    expect(problem).toMatch(/360 MB/);
    expect(problem).toMatch(/200 MB/);
  });

  it('is a filter, not a guarantee — 2.5x is a heuristic', () => {
    // A real emulator with 546 MB free failed to install a 144 MB build with
    // INSTALL_FAILED_INSUFFICIENT_STORAGE, and this check passes that case:
    // Android also needs room for dex compilation and the existing install,
    // which we cannot see from here. Raising the multiplier until this one
    // datum is covered would block legitimate updates on healthy devices.
    //
    // So this catches the clear-cut cases cheaply, before the download is
    // paid for, and UpdateSection's AppState handler catches everything else
    // by noticing the install never happened.
    expect(describeSpaceProblem(144 * MB, 546 * MB)).toBeNull();
  });

  it('needs room for the download and the install, not just the file', () => {
    // 200 MB free and a 100 MB APK looks like plenty and isn't: Android needs
    // a second copy plus room to extract.
    expect(describeSpaceProblem(100 * MB, 200 * MB)).toMatch(/Not enough free space/);
    expect(describeSpaceProblem(100 * MB, 300 * MB)).toBeNull();
  });

  it('allows the update through when the size is unknown', () => {
    // Refusing on a missing Content-Length would block updates over any server
    // that doesn't send one; the post-download check still applies.
    expect(describeSpaceProblem(null, 10 * MB)).toBeNull();
    expect(describeSpaceProblem(0, 10 * MB)).toBeNull();
  });
});
