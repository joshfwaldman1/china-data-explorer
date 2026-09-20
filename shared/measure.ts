/**
 * What a number is, as fields rather than as a sentence.
 *
 * Every series carries a unit written for a reader ("Hundred million yuan
 * (亿元), cumulative year to date"), and the page used to decide how to
 * print a value by running regular expressions over that sentence at render
 * time. That is how a per-thousand birth rate came to be shown with a
 * percent sign: the rule that catches "%" caught "‰" too, and nothing said
 * what the series actually was.
 *
 * So a series now carries a measure: what kind of number it is, what to put
 * after the value, how many decimals it is quoted to, how a change in it is
 * written, and whether it accumulates through the year. The sentence stays,
 * because a reader wants it; the page no longer reads it.
 *
 * A measure is derived from the unit where a series does not declare one, so
 * no entry is forced to repeat itself, and a declaration wins over the
 * derivation wherever the publisher's wording would mislead.
 */

export type MeasureKind = "level" | "rate" | "index";

export interface Measure {
  /** A quantity of something, a percentage-like rate, or an index number. */
  kind: MeasureKind;
  /** What follows the value on a compact row: "%", "‰", "100M yuan", "hours", or nothing. */
  suffix: string;
  /** Decimals to show, or "source" to keep what the publisher wrote (a level). */
  decimals: number | "source";
  /** How a change from the period before reads: percentage points, points, or the series' own units. */
  change: "pp" | "pt" | "absolute";
  /** True when each figure runs from the start of the year rather than covering one period. */
  cumulative: boolean;
}

/** Rates a market quotes to two decimals rather than one. */
const TWO_DECIMAL_RATE = /fixing|close|yield|per annum|‰|per thousand/i;

/** The scale words publishers use, and the short form shown beside a value. */
const SCALES: [RegExp, string][] = [
  [/^hundred millions? (of )?/i, "100M "],
  [/^ten thousands? (of )?/i, "10k "],
  [/^trillions? (of )?/i, "tn "],
  [/^billions? (of )?/i, "bn "],
  [/^millions? (of )?/i, "M "],
];

/**
 * The thing being counted, shortened to something that reads beside a
 * number: "Trillions of current US dollars" becomes "tn USD", "Births per
 * woman" becomes "births". A price basis the World Bank writes into its
 * units ("current", "constant") is not part of what is counted.
 */
function countedThing(head: string): string {
  const scaled = SCALES.reduce((text, [pattern, short]) => pattern.test(text) ? text.replace(pattern, short) : text, head.trim());
  const basis = scaled.replace(/\b(current|constant)\s+/i, "");
  // "Births per woman", "Persons per household": the row says the rest, the value needs the noun.
  const counted = / per /i.test(basis) ? (basis.split(/ per /i)[0] ?? basis).toLocaleLowerCase() : basis;
  return counted
    .replace(/\bUS dollars?\b/i, "USD")
    .replace(/\bsquare metres\b/i, "m²")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The measure a unit describes, with any declared fields overriding it.
 * Derivation reads the unit once, here, rather than in the page.
 */
export function measureOf(unit: string, declared: Partial<Measure> = {}): Measure {
  const cumulative = /cumulative|year to date/i.test(unit);
  const head = (unit.split(/[(,]/)[0] ?? "").trim();
  let derived: Measure;

  if (/‰|per thousand/i.test(unit)) {
    // A per-thousand rate: the same arithmetic as a percentage, a different mark, and its change is in points.
    derived = { kind: "rate", suffix: "‰", decimals: 2, change: "pt", cumulative };
  } else if (/index|=\s*100|=\s*neutral/i.test(unit)) {
    // An index has no unit to print and moves in its own points.
    derived = { kind: "index", suffix: "", decimals: 1, change: "absolute", cumulative };
  } else if (/%|percent/i.test(unit)) {
    derived = { kind: "rate", suffix: "%", decimals: TWO_DECIMAL_RATE.test(unit) ? 2 : 1, change: "pp", cumulative };
  } else if (/^yuan per\b/i.test(head)) {
    // An exchange rate or a per-person amount: a quantity of yuan, quoted as the publisher writes it.
    derived = { kind: "level", suffix: "yuan", decimals: "source", change: "absolute", cumulative };
  } else if (/^hours?\b/i.test(head)) {
    derived = { kind: "level", suffix: "hours", decimals: "source", change: "absolute", cumulative };
  } else if (/^(years|number|enterprises|persons)\b/i.test(head)) {
    derived = { kind: "level", suffix: "", decimals: "source", change: "absolute", cumulative };
  } else {
    derived = { kind: "level", suffix: countedThing(head), decimals: "source", change: "absolute", cumulative };
  }
  return { ...derived, ...declared };
}

/** True for anything that is not a quantity of something: the old isRate, by another route. */
export function isRateMeasure(measure: Measure): boolean {
  return measure.kind !== "level";
}
