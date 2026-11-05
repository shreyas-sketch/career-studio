// Every factual comparison rests on exact words from the right document. These
// checks compare text the way a reader would (ignoring case, spacing and curly
// quotes) and find where a quote sits, so the page can highlight it.

const FOLD: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " " };

const fold = (char: string) => (FOLD[char] ?? char).toLowerCase();

/** Folded text, with where each character came from in the original. */
function folded(text: string): { value: string; origin: number[] } {
  let value = "";
  const origin: number[] = [];
  let space = true;
  for (let index = 0; index < text.length; index++) {
    const char = fold(text[index]);
    if (/\s/.test(char)) {
      if (space) continue;
      space = true;
      value += " ";
      origin.push(index);
    } else {
      space = false;
      for (const piece of char) {
        value += piece;
        origin.push(index);
      }
    }
  }
  return { value: value.trimEnd(), origin };
}

const MIN_QUOTE = 8;

/** The words a quote is compared by, without bullets and outer punctuation a model may add or drop. */
export function cleanQuote(quote: string): string {
  return quote.trim().replace(/^[\s\-*•·"'“”‘’]+/, "").replace(/[\s"'“”‘’]+$/, "");
}

/** Whether `quote` really is in `text`. */
export function isGrounded(text: string, quote: string): boolean {
  const wanted = folded(cleanQuote(quote)).value;
  return wanted.length >= MIN_QUOTE && folded(text).value.includes(wanted);
}

export type Segment = { text: string; marked: boolean };

/** `text` split around each quote that's in it, for rendering marks. Overlaps merge; nothing is cut. */
export function highlighted(text: string, quotes: readonly string[]): Segment[] {
  const { value, origin } = folded(text);
  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    const wanted = folded(cleanQuote(quote)).value;
    if (wanted.length < MIN_QUOTE) continue;
    const at = value.indexOf(wanted);
    if (at < 0) continue;
    ranges.push([origin[at], origin[at + wanted.length - 1] + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  let position = 0;
  for (const [start, end] of ranges) {
    if (end <= position) continue;
    const from = Math.max(start, position);
    if (from > position) segments.push({ text: text.slice(position, from), marked: false });
    segments.push({ text: text.slice(from, end), marked: true });
    position = end;
  }
  if (position < text.length) segments.push({ text: text.slice(position), marked: false });
  return segments;
}
