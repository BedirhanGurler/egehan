# Contributing to Egehan

Thanks for considering it. This project tries to stay small, readable and dependency-free, so a few
conventions matter more here than they might elsewhere.

## Getting set up

```bash
git clone https://github.com/BedirhanGurler/egehan.git
cd egehan
npm install          # npm ships with Node; nothing else is required
npm test             # the whole workspace
npm run spec:validate
```

Node 20.12 or newer. That is the only prerequisite for everything except the .NET tool (which needs a
.NET 8 or .NET 10 SDK) and the Visual Studio extension (which needs Windows and the Visual Studio SDK).

## The one rule that matters most

**Engine behaviour lives in `packages/core-spec` as data, never as code in an engine.** Thresholds,
category definitions and narrative templates belong in `spec/rules.json` and `dictionary/*.json`. If you
find yourself writing a number like `1.5` or `48` inside an engine, it belongs in the rules file instead.
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains why at length — ADR-001.

A change to the rules or the dictionaries changes the output of _every_ engine. That is intended. Expect
the conformance fixtures to move, and review that diff carefully: it is the clearest signal you will get
about whether your change said what you meant.

## Adding a language

The highest-value contribution anyone can make, and it needs no code:

1. Copy `packages/core-spec/dictionary/narratives.en.json` to `narratives.<code>.json`.
2. Translate every string. Keep the structure identical — the validator enforces that.
3. Run `npm run spec:validate`. It will tell you about missing keys, unknown placeholders, duplicated
   variants and incomplete translations.
4. Write naturally in your language rather than translating the English literally. The point of a tone
   called `poetic` is that it reads like something a person would write.

A note for languages with rich inflection: avoid attaching suffixes directly to an interpolated variable.
`«{subject}» sorunu giderildi` works for any commit message; `{subject}'i düzeltti` produces broken grammar
half the time, because the suffix depends on the final vowel of a word the engine cannot predict. The
Turkish dictionary is written this way throughout and is a reasonable model to follow.

## Code conventions

- TypeScript, strict mode, ESM. No `any` without a comment explaining why.
- Runtime dependencies are effectively frozen. The published CLI has exactly one (`commander`), and a PR
  adding another needs to make a case in the description. Dev dependencies are easier, but still argued.
- Tests use `node:test`. New behaviour arrives with tests; a bug fix arrives with the test that would
  have caught it.
- Comments explain _why_, not _what_. If a line needs a comment to say what it does, rewrite the line.

## Commits and pull requests

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`). Egehan narrates
its own history, so a clear subject line is its own reward here.

Keep pull requests focused on one thing. In the description, say what changed and why — and if the change
touches the rules or the dictionaries, say what you expect the fixture diff to look like.

## Reporting a bug

Include the Egehan version, your platform, and what you expected versus what happened. If the problem is
in the generated story, the most useful thing you can attach is the commit subject and metadata that
produced the wrong sentence — not the repository itself.

Please do not paste a real `git log` from a private repository into a public issue. A synthetic fixture
that reproduces the problem is both safer and more useful, and `packages/core-spec/fixtures/` shows the
format.
