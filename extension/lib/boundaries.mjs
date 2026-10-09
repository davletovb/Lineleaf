// Shared by source validation and browser selection capture; no language dictionary or worker imports.
export function boundaries(text) {
  return new Set([text.length, ...Array.from(new Intl.Segmenter('en', {granularity: 'grapheme'}).segment(text), x => x.index)]);
}
