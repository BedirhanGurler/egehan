# egehan

**Turn a project's `git log` into a living chronicle — offline, deterministic, no API key.**

[![npm](https://img.shields.io/npm/v/egehan.svg)](https://www.npmjs.com/package/egehan)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](https://github.com/BedirhanGurler/egehan/blob/main/LICENSE)

Every repository already contains a story: the night a race condition was finally cornered, the
week everything broke at once, the commit that deleted a thousand lines and made the project
better. `git log` records all of it and tells none of it.

Egehan reads that history and writes the story down — as a Markdown chronicle you can commit, and
an interactive single-file HTML timeline you can open anywhere.

```bash
npx egehan
```

## What you get

**A narrated history.** Every commit is placed in one of six chapters — birth, first steps,
growing pains, midnight oil, milestone, evolution — and narrated in one of three tones
(`poetic`, `minimalist`, `humorous`) in Turkish or English.

```text
Raw:    fix: token refresh race condition   (2026-03-14 03:18, 4 files, +85/-42)

Poetic: 14 Mart gecesi saat 03:18 sularında, herkes uyurken 4 dosyada titiz bir
        çalışma yapıldı; «token refresh race condition» ile sistemin nefesi düzeltildi.
```

**A Developer Pulse.** Your coding chronotype, most productive day and hour, the ratio of code
created to code refined, and your longest unbroken commit streak.

**A living chronicle.** One `egehan hook install` and every later commit quietly updates it.

## Why no AI

A keepsake should still work in ten years, on a plane, in a repository nobody is allowed to upload
anywhere. The narration is a rule engine over commit metadata, not a model:

- **Deterministic.** The chosen sentence is `parseInt(sha[0..8], 16) % variants.length`. Running
  it again never rewrites history, so the generated files produce clean, reviewable diffs.
- **Offline.** No requests, ever. Nothing about your repository leaves your machine.
- **Private by default.** Author e-mail addresses are redacted before anyone can publish them.

## Commands

```bash
egehan init                                  # interactive setup, writes .egehanrc.json
egehan generate --format both                # EGEHAN.md + egehan-chronicle.html
egehan generate --since v1.0.0 --output docs # a chapter of its own
egehan hook install                          # keep it updating on every commit
egehan stats                                 # the Developer Pulse, in the terminal
egehan capsule --unlock-date 2044-02-01      # a passphrase-sealed letter to the future
```

Node 20.12 or newer, and `git` on your PATH. One runtime dependency: `commander`.

## The rest of the toolchain

The same engine, the same output, three places:

|         |                                     |
| ------- | ----------------------------------- |
| npm     | `npx egehan` — this package         |
| NuGet   | `dotnet tool install -g Egehan.Cli` |
| VS Code | `Egehan — Living Code Chronicle`    |

The Node and .NET engines are held to the same conformance fixtures, and a test asserts they
produce `EGEHAN.md` byte for byte alike.

## Documentation

- [Full README and screenshots](https://github.com/BedirhanGurler/egehan#readme)
- [Türkçe](https://github.com/BedirhanGurler/egehan/blob/main/README.tr.md)
- [Architecture and the decisions behind it](https://github.com/BedirhanGurler/egehan/blob/main/docs/ARCHITECTURE.md)
- [Adding your language](https://github.com/BedirhanGurler/egehan/blob/main/CONTRIBUTING.md)

MIT.
