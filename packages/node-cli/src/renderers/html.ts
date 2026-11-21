import { readFileSync } from 'node:fs';
import { assetPath } from '../spec/assets.js';
import type { Dictionary } from '../spec/dictionary.js';
import { loadRules, type EgehanRules } from '../spec/rules.js';
import type { Category, Chronotype, EgehanReport } from '../engine/types.js';

/**
 * Renders `egehan-chronicle.html`.
 *
 * The renderer is deliberately almost nothing: it injects the report and the language strings into
 * `core-spec/templates/egehan-book.html`, which draws the page itself. That split is the point.
 * Presentation lives in one file that every engine shares, so the Node and the .NET
 * implementations produce a byte-identical chronicle instead of each assembling HTML strings that
 * would drift apart over a few releases (docs/ARCHITECTURE.md, ADR-001 and ADR-011).
 *
 * The cost is that the page needs JavaScript to render. The template carries a `<noscript>` block
 * pointing at `EGEHAN.md`, which is the same story in a format that needs nothing at all.
 */

const MARKERS = {
  lang: '__EGEHAN_LANG__',
  theme: '__EGEHAN_THEME__',
  title: '__EGEHAN_TITLE__',
  report: '__EGEHAN_REPORT__',
  strings: '__EGEHAN_STRINGS__',
} as const;

/** The subset of the dictionary the page needs. Sending the whole thing would ship 100 kB of unused templates. */
interface PageStrings {
  readonly language: string;
  readonly locale: Dictionary['locale'];
  readonly units: Dictionary['units'];
  readonly ui: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, { readonly label: string; readonly icon: string }>>;
  readonly pulse: {
    readonly title: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly chronotypes: Readonly<Record<string, { readonly label: string; readonly icon: string }>>;
  };
  readonly crypto: { readonly additionalDataFormat: string };
}

export function renderHtml(report: EgehanReport, dictionary: Dictionary, rules?: EgehanRules): string {
  const resolvedRules = rules ?? loadRules();
  const template = readTemplate();

  const title = interpolate(dictionary.ui['documentTitle'] ?? '{project}', {
    project: report.project.name,
  });

  return [
    [MARKERS.lang, escapeAttribute(report.config.language)],
    [MARKERS.theme, escapeAttribute(report.config.theme)],
    [MARKERS.title, escapeText(title)],
    [MARKERS.report, embedJson(reportForPage(report, resolvedRules))],
    [MARKERS.strings, embedJson(pageStrings(dictionary, resolvedRules))],
  ].reduce((html, [marker, value]) => replaceOnce(html, marker as string, value as string), template);
}

export function readTemplate(): string {
  return readFileSync(assetPath('templates', 'egehan-book.html'), 'utf8');
}

/**
 * The report as the page receives it.
 *
 * `generator.generatedAt` is blanked unless the contract asks for it, because the rendered
 * artifacts are meant to be committed: a timestamp here would mean a post-commit hook attaches a
 * diff to every commit in the project forever (rules.json → output.embedGenerationTimeInArtifacts).
 */
function reportForPage(report: EgehanReport, rules: EgehanRules): EgehanReport {
  if (rules.output.embedGenerationTimeInArtifacts) return report;
  return { ...report, generator: { ...report.generator, generatedAt: '' } };
}

function pageStrings(dictionary: Dictionary, rules: EgehanRules): PageStrings {
  const categories: Record<string, { label: string; icon: string }> = {};
  for (const [id, narratives] of Object.entries(dictionary.categories)) {
    categories[id as Category] = { label: narratives.label, icon: narratives.icon };
  }

  const chronotypes: Record<string, { label: string; icon: string }> = {};
  for (const [id, chronotype] of Object.entries(dictionary.pulse.chronotypes)) {
    chronotypes[id as Chronotype] = { label: chronotype.label, icon: chronotype.icon };
  }

  return {
    language: dictionary.language,
    locale: dictionary.locale,
    units: dictionary.units,
    ui: withoutComments(dictionary.ui),
    categories,
    pulse: {
      title: dictionary.pulse.title,
      labels: withoutComments(dictionary.pulse.labels),
      chronotypes,
    },
    crypto: { additionalDataFormat: rules.capsule.additionalDataFormat },
  };
}

function withoutComments(source: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('$')));
}

/**
 * Serializes JSON for embedding inside a `<script type="application/json">` block.
 *
 * `<` becomes `<`, which is what stops a commit subject containing `</script>` from ending
 * the block and turning the rest of the chronicle into markup. That is not a hypothetical: commit
 * messages are written by anyone who can push, and this file is opened by the maintainer. The
 * paragraph and line separators are escaped for the same class of reason.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * Replaces a marker that must appear exactly once.
 *
 * Failing loudly matters here: a template edit that renamed or duplicated a marker would otherwise
 * ship a chronicle with `__EGEHAN_REPORT__` sitting in it, or with the data injected twice.
 */
function replaceOnce(html: string, marker: string, value: string): string {
  const parts = html.split(marker);
  if (parts.length !== 2) {
    throw new Error(
      `The chronicle template must contain "${marker}" exactly once, but it appears ` +
        `${parts.length - 1} time(s). The template and the renderer are out of step.`,
    );
  }
  return parts.join(value);
}

function interpolate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => values[name] ?? match);
}
