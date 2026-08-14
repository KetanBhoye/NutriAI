import { describe, expect, it } from 'vitest';
import { describeDownloadProblem } from './verify';

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
