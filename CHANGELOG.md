# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html) across all three published artifacts —
they share one version on purpose, and the release workflow refuses to publish when they disagree.

## [0.1.0] — unreleased

The first release.

### The contract

- `core-spec`: the report JSON Schema, the engine rules, the narrative dictionaries for Turkish and
  English, the single-file HTML template, the git hook script, and the conformance fixtures.
  Data only, no code, so that neither engine can quietly become the specification.
- A dictionary validator wired into CI: it refuses a language file whose structure drifts from the
  reference, whose templates interpolate a variable the engine does not provide, or whose
  sentences duplicate each other inside one variant list.

### The npm CLI (`egehan`)

- A zero-dependency git reader that forces UTF-8 everywhere and reads annotated tags correctly.
- The story engine: six categories, three tones, two languages, chosen deterministically from the
  commit sha so the same commit always produces the same sentence.
- The Developer Pulse: chronotype, busiest period, creation ratio, streaks, monthly activity.
- `EGEHAN.md` and `egehan-chronicle.html` renderers, neither of which embeds a generation
  timestamp — the files only change when the history does.
- `egehan capsule`: a passphrase-sealed message (PBKDF2-SHA-256, 600 000 iterations → AES-256-GCM),
  openable from the generated page by Web Crypto. Sealed mode only; there is no passphrase-free
  option, because a file that can decrypt itself protects nothing.
- `egehan hook install`: a background, non-blocking hook that never stages or commits anything,
  installs alongside Husky, and steps aside for Lefthook with the configuration to add.
- One runtime dependency: `commander`.

### The interactive timeline

- A single self-contained HTML file: no network requests, no fonts, no libraries. Pure SVG charts,
  light and dark themes, filters and search, and a countdown for the time capsule.
- Everything repository-derived is written with `textContent`, and the embedded JSON escapes `<`,
  so a commit message cannot become markup.

### The VS Code extension

- A status bar entry with the project's age and commit count, in the chronicle's own language.
- The timeline in an editor tab, under a strict Content-Security-Policy with a per-panel nonce.
- Milestone notifications, silent on the first run so an existing repository's history is recorded
  rather than announced.

### The .NET tool (`Egehan.Cli`)

- The engine ported to C#, targeting `net8.0` and `net10.0`, with `RollForward=Major`.
- Held to the Node engine's own fixtures: the report matches structurally, `EGEHAN.md` matches
  byte for byte, and the HTML differs only in `generator.platform`.
- A capsule sealed by the Node engine opens here, and in the browser, from one set of parameters.
