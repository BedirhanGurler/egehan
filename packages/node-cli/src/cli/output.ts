import { styleText } from 'node:util';

/**
 * Terminal output.
 *
 * Colour comes from `node:util.styleText`, which has been in Node since 20.12 — so the published
 * CLI needs no colour library and therefore cannot be broken by one. Styling is suppressed when
 * the stream is not a TTY, when `NO_COLOR` is set, or when `TERM=dumb`, which together cover
 * piping to a file, CI logs and the git hook that runs this tool in the background.
 */

type Style = Parameters<typeof styleText>[0];

const colorEnabled = ((): boolean => {
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return false;
  if (process.env['FORCE_COLOR'] !== undefined && process.env['FORCE_COLOR'] !== '') return true;
  if (process.env['TERM'] === 'dumb') return false;
  return process.stdout.isTTY === true;
})();

export function paint(style: Style, text: string): string {
  return colorEnabled ? styleText(style, text) : text;
}

export const theme = {
  heading: (text: string): string => paint(['bold'], text),
  accent: (text: string): string => paint(['green'], text),
  muted: (text: string): string => paint(['dim'], text),
  warn: (text: string): string => paint(['yellow'], text),
  error: (text: string): string => paint(['red', 'bold'], text),
  value: (text: string): string => paint(['cyan', 'bold'], text),
} as const;

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function success(message: string): void {
  process.stdout.write(`${theme.accent('✔')} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${theme.warn('!')} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${theme.error('✖')} ${message}\n`);
}

/**
 * Column width of a string as a terminal will actually render it.
 *
 * Counting characters is not enough: an emoji occupies two columns, a variation selector occupies
 * none but widens the symbol before it, and combining marks occupy none at all. Getting this wrong
 * is visible — the category icons pushed the right-hand border of the stats panel one column out,
 * on every line that had one. A dependency for this would be a dependency in a CLI that promises
 * not to have any, and the ranges below cover what this tool actually prints.
 */
const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f000, 0x1f02f],
  [0x1f0a0, 0x1f0ff],
  [0x1f100, 0x1f1ff],
  [0x1f200, 0x1f2ff],
  [0x1f300, 0x1f9ff],
  [0x1fa00, 0x1faff],
  [0x20000, 0x3fffd],
];

const isWide = (codePoint: number): boolean =>
  WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);

export function visibleWidth(text: string): number {
  const plain = text.replace(/\u001b\[[0-9;]*m/g, '');
  let width = 0;

  for (const character of plain) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    // U+FE0F (variation selector-16) renders the preceding symbol in emoji form, which is two
    // columns wide: the selector itself takes none, so it contributes the missing column.
    if (codePoint === 0xfe0f) {
      width += 1;
      continue;
    }
    // Zero-width joiner, other variation selectors and combining marks occupy no columns.
    if (codePoint === 0x200d || (codePoint >= 0xfe00 && codePoint <= 0xfe0e)) continue;
    if (codePoint >= 0x0300 && codePoint <= 0x036f) continue;

    width += isWide(codePoint) ? 2 : 1;
  }

  return width;
}
