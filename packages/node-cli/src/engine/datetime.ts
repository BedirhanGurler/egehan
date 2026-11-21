/**
 * Timestamp handling for the story engine.
 *
 * The single most important rule in this file: **a commit's wall-clock time is the one recorded in
 * the commit, and it is never converted.** `git log %aI` yields the author's local time together
 * with its UTC offset, and that offset is what makes "midnight oil" mean midnight where the
 * developer actually was. Using the host's timezone would make the output depend on who runs the
 * tool; converting to UTC would turn a 03:18 commit in Istanbul into a 00:18 one and quietly
 * destroy the most legible signal in the whole history (docs/ARCHITECTURE.md, ADR-003).
 *
 * Consequently this module parses the ISO string's fields directly and uses `Date` only for
 * instant arithmetic, never for field extraction.
 */

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface LocalTimestamp {
  /** The original string, unmodified. */
  readonly iso: string;
  /** Absolute instant, for ordering and durations. */
  readonly epochMs: number;
  /** Minutes east of UTC, as recorded by the commit. */
  readonly offsetMinutes: number;
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 0 = Monday, matching rules.json → time.weekStartsOn. */
  readonly weekday: number;
  /** `YYYY-MM-DD` in the commit's own timezone — the unit streaks are counted in. */
  readonly dayKey: string;
  /** `YYYY-MM` in the commit's own timezone. */
  readonly monthKey: string;
}

export function parseTimestamp(iso: string): LocalTimestamp {
  const match = ISO_PATTERN.exec(iso);
  if (match === null) {
    throw new Error(`Not an ISO-8601 timestamp with an offset: "${iso}"`);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetText] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const epochMs = Date.parse(iso);
  if (!Number.isFinite(epochMs)) {
    throw new Error(`Unparseable timestamp: "${iso}"`);
  }

  // Day-of-week from the *local* calendar date. Date.UTC is used purely as a calendar function
  // here, so the host timezone cannot influence the result.
  const utcWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    iso,
    epochMs,
    offsetMinutes: parseOffset(offsetText),
    year,
    month,
    day,
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
    weekday: (utcWeekday + 6) % 7,
    dayKey: `${yearText}-${monthText}-${dayText}`,
    monthKey: `${yearText}-${monthText}`,
  };
}

function parseOffset(offset: string): number {
  if (offset === 'Z') return 0;
  const sign = offset.startsWith('-') ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));
  return sign * (hours * 60 + minutes);
}

/** Calendar days from `from` to `to`, inclusive of both ends. Day-key based, so DST cannot skew it. */
export function inclusiveDaySpan(from: LocalTimestamp, to: LocalTimestamp): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

/** Days between two day keys, as a signed count. */
export function dayKeyDistance(earlier: string, later: string): number {
  return dayKeyToNumber(later) - dayKeyToNumber(earlier);
}

const MS_PER_DAY = 86_400_000;

function dayNumber(timestamp: LocalTimestamp): number {
  return Date.UTC(timestamp.year, timestamp.month - 1, timestamp.day) / MS_PER_DAY;
}

function dayKeyToNumber(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function hoursBetween(earlier: LocalTimestamp, later: LocalTimestamp): number {
  return (later.epochMs - earlier.epochMs) / 3_600_000;
}

/** `03:18` — zero-padded, locale-independent. */
export function formatClock(timestamp: LocalTimestamp, template: string): string {
  return template
    .replace('{hour}', String(timestamp.hour).padStart(2, '0'))
    .replace('{minute}', String(timestamp.minute).padStart(2, '0'));
}

/** `14 Mart 2026` / `14 March 2026`, driven entirely by the dictionary's month names. */
export function formatDate(
  timestamp: LocalTimestamp,
  template: string,
  monthNames: readonly string[],
): string {
  const monthName = monthNames[timestamp.month - 1];
  if (monthName === undefined) {
    throw new Error(`The dictionary provides no name for month ${timestamp.month}`);
  }
  return template
    .replace('{day}', String(timestamp.day))
    .replace('{month}', monthName)
    .replace('{year}', String(timestamp.year));
}

/** The ISO timestamp of "now", with the host's offset preserved rather than normalized to Z. */
export function nowIso(now: Date = new Date()): string {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const pad = (value: number): string => String(value).padStart(2, '0');

  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}
