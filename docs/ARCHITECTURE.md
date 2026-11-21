# Architecture

This document records how Egehan is put together and, more importantly, **why** — so that a decision made
once does not have to be re-argued from scratch a year later, by a contributor or by the author.

## 1. The shape of the system

```text
                 ┌──────────────────────────────────────────┐
                 │            packages/core-spec            │
                 │  DATA ONLY — no implementation code      │
                 │                                          │
                 │  schema/egehan-report.schema.json        │
                 │  spec/rules.json                         │
                 │  dictionary/narratives.{tr,en}.json      │
                 │  templates/egehan-book.html              │
                 │  fixtures/<name>/{input,expected}.json   │
                 └───────────────┬──────────────────────────┘
                                 │ read at runtime / embedded at build
            ┌────────────────────┴───────────────────┐
            ▼                                        ▼
  ┌───────────────────────┐              ┌────────────────────────┐
  │   packages/node-cli   │              │  packages/dotnet-tool  │
  │   (npm: egehan)       │              │  (NuGet: Egehan.Cli)   │
  │                       │              │                        │
  │  git/     reader      │              │  Egehan.Core           │
  │  engine/  classifier  │              │  Egehan.Cli            │
  │           narrator    │              │                        │
  │           pulse       │              │  net8.0 + net10.0      │
  │  renderers/ md, html  │              │                        │
  └───────┬───────────────┘              └────────────────────────┘
          │                                          │
          ▼                                          ▼
  ┌─────────────────────────┐          ┌──────────────────────────┐
  │ extensions/vscode       │          │ extensions/visual-studio │
  └─────────────────────────┘          └──────────────────────────┘
```

Both engines follow the same pipeline, and the boundary between the stages is deliberate:

```text
git log  ──▶  NormalizedCommit[]  ──▶  EgehanReport  ──▶  EGEHAN.md          (renderer builds it)
             (platform-specific)       (must be identical     egehan-chronicle.html (template draws itself)
                                        in every runtime)     status bar / stats
```

Everything to the left of `NormalizedCommit[]` is plumbing: spawning processes, surviving Windows path
quoting, forcing UTF-8. Everything to the right must behave the same in every runtime, which is why the
conformance fixtures start exactly at that boundary.

## 2. Decision log

### ADR-001 — `core-spec` contains data and never code

**Decision.** The report schema, the classification thresholds, the narrative templates and the HTML
template live in `packages/core-spec` as plain JSON and HTML. It has no `src/`, no build step and nothing
to import.

**Why.** Egehan ships two engines and may ship more. If the thresholds or the narrative templates lived
inside one of them, that engine would silently become the specification and the other would drift behind
it — the classic two-implementations failure, and the one most likely to quietly ruin a project
maintained by one person in their spare time. Keeping the rules in data makes "the two engines agree" a
property CI can _prove_ against shared fixtures, rather than a promise someone has to keep.

**Consequence.** Each engine declares its own types for the schema, which could drift from the schema
itself; CI closes that gap by validating generated reports against `egehan-report.schema.json`. A change
to `spec/rules.json` is expected to move every fixture's expected output — reviewing that diff is how you
find out whether the rule change said what you meant.

### ADR-002 — Narration is deterministic, offline and rule-based

**Decision.** No LLM, no network, no randomness. Template choice is
`parseInt(sha.slice(0,8), 16) % variants.length`.

**Why.** Three independent reasons, each sufficient on its own. A keepsake must still work in ten years
with no API key and no vendor. Many repositories may not legally be sent to a third-party service. And a
generator whose output changes on every run produces a churning diff, which makes the artifacts
impossible to keep in version control — the exact opposite of a chronicle.

**Consequence.** Narrative variety has to come from the dictionaries and the interpolated data rather
than from a model, so the dictionaries carry 108 entry templates per language and the validator rejects
duplicates within a variant list (a duplicate would skew the deterministic choice).

**Consequence, learned the hard way.** Determinism is a property of the _whole artifact_, not just of
the sentences. The Markdown renderer originally printed the generation timestamp in its footer, which
meant every `egehan generate` changed the file — so the post-commit hook of ADR-006 would have attached a
one-line diff to every commit in the project, forever. `rules.json → output.embedGenerationTimeInArtifacts`
is now `false`: the rendered artifacts depend only on the repository, and `generator.generatedAt` survives
only in the JSON report, which is the machine format and the right place for provenance. A test asserts
that the rendered chronicle contains no timestamp, because this is an easy mistake to make twice.

### ADR-003 — The local hour is preserved, never normalized

**Decision.** `localHour` and `localWeekday` come from the commit's own ISO-8601 offset. Timestamps are
never converted to UTC or to the reader's timezone.

**Why.** "Midnight oil" has to mean midnight where the developer actually was. Normalizing to UTC would
turn a 03:18 commit in Istanbul into a 00:18 commit, and a 03:18 commit in São Paulo into a 06:18 one —
destroying the single most emotionally legible signal in the whole history.

### ADR-004 — E-mail addresses are redacted by default

**Decision.** `redactEmails` defaults to `true`. The report carries a truncated SHA-256 of the lowercased
address for identity merging and avatar seeding; `--anonymize` additionally replaces display names.

**Why.** The tool reads `git log` — which contains every contributor's e-mail address — and writes an HTML
file explicitly designed to be shared. A default that leaks a team's addresses the first time someone
runs the tool on a corporate repository would make Egehan unusable in exactly the environments it is
meant for. Privacy here is not a feature; it is the condition of adoption.

### ADR-005 — The time capsule is sealed-only

**Decision.** `egehan capsule` supports one mode: PBKDF2-SHA-256 (600 000 iterations) → AES-256-GCM,
passphrase required, minimum 12 characters. There is no passphrase-free "symbolic" mode. Capsule files
are not git-tracked by default.

**Why.** The ciphertext is embedded in an HTML file the user is likely to publish. A date check performed
in the browser is cosmetic — anyone can change their clock or open the console. A capsule the file can
decrypt by itself is a capsule every reader can decrypt, so shipping that mode would mean advertising
encryption while providing none. Offering it "for convenience" would mostly serve to get someone's
private letter read.

**Why PBKDF2 and not scrypt or Argon2.** The capsule must be decryptable in the browser from the
generated HTML, in Node, and in .NET. Web Crypto provides PBKDF2 and neither of the others, so PBKDF2 is
the only algorithm all three runtimes share. The iteration count compensates within that constraint.

### ADR-006 — Hooks never commit, never stage, never block

**Decision.** `egehan hook install` appends a marked block to `.git/hooks/post-commit` and `post-merge`
that regenerates the artifacts in a detached, non-blocking process. It never runs `git add` or
`git commit`, it detects `core.hooksPath` and existing Husky/Lefthook setups and installs alongside them,
and it no-ops during rebase, merge and bisect.

**Why.** A hook that stages or commits its own output corrupts repositories: it fights interactive
rebase, pollutes bisect, and in the worst case recurses. A hook that blocks makes every commit slower and
gets uninstalled within a week. The artifacts are regenerated silently and committed by the developer
whenever they choose, which works because the generator is deterministic (ADR-002) and therefore idempotent.

**Deference to whoever owns the hooks.** Most repositories that would want Egehan already run something
on commit, and taking over `.git/hooks` is the surest way to get uninstalled. With Husky the block goes
into `.husky/<hook>` — the file a human owns in both v8 and v9, and the one that survives
`husky install` — never into the `_` directory Husky regenerates. With Lefthook nothing is written at
all: Lefthook rewrites its hook files on every install, so anything appended there would vanish without
warning. The command prints the `lefthook.yml` entries to add instead, which is slower for the user and
the only honest option.

**Consequence, learned the hard way.** The hooks directory is resolved with
`git rev-parse --absolute-git-dir`. The obvious `--git-dir` answers a _relative_ `.git` when run from
the repository root, and resolving that against the process working directory installs the hook into
whichever repository the tool itself is running from. A test caught it doing exactly that — which is why
the test suite asserts the resolved directory lies inside the repository being operated on.

### ADR-007 — TypeScript, npm workspaces, Node's own test runner

**Decision.** TypeScript compiled to ESM, npm workspaces (not pnpm), `node:test` for tests,
`node:util.styleText` instead of a colour library. The published `egehan` package has exactly one runtime
dependency: `commander`.

**Why.** npm ships with Node, so a contributor needs nothing beyond a Node install — for an open-source
project hoping for drive-by contributions, every extra required tool is a filter. `node:test` and
`styleText` are good enough for this project's needs, and every dependency avoided is a dependency that
cannot break, bloat or get compromised. TypeScript is non-negotiable in the other direction: five
packages sharing one data contract without compile-time checking is how silent drift happens.

### ADR-008 — The .NET tool multi-targets `net8.0` and `net10.0`

**Decision.** `Egehan.Cli` is packed for both `net8.0` and `net10.0`, with `RollForward=Major`.

**Why.** A global tool is independent of the user's project framework, but not of the runtime installed
on their machine. .NET 8 left support in November 2026, so shipping only `net8.0` would mean launching on
an unsupported runtime; shipping only `net10.0` would fail on the many corporate machines that still have
only the .NET 8 runtime. `RollForward=Major` keeps the `net8.0` asset working as newer runtimes appear.

### ADR-009 — Phased delivery, Visual Studio last

**Decision.** Phase 1 ships the spec, the CLI and the HTML timeline as a complete, tested product. The
VS Code extension, the .NET tool and the VSIX follow in that order.

**Why.** Porting the engine to C# before it has settled means porting a moving target twice. And the
Visual Studio VSIX cannot be built or tested on macOS at all — the VS SDK is Windows-only — so it can
only be verified in CI on a Windows runner. Putting an unverifiable deliverable in the first release
would risk the credibility of everything shipped alongside it.

### ADR-011 — The HTML chronicle renders itself from injected data

**Decision.** `core-spec/templates/egehan-book.html` is a complete page that draws the chronicle
client-side from two JSON blocks the renderer injects. The renderer replaces five markers and does
nothing else; it assembles no HTML.

**Why.** The alternative — each engine building HTML strings — would mean the Node and the .NET
implementations each own a copy of the presentation, and byte-identical output would depend on two
people writing the same markup forever. With a shared template, "both engines produce the same
file" is true by construction: same template, same data, same bytes. It also means a design change
is one edit to one file rather than a coordinated change across two languages.

**Consequence.** The page needs JavaScript. That is a real cost for a keepsake, and it is paid down
two ways: a `<noscript>` block explains the situation and points at `EGEHAN.md`, which is the same
story in a format that needs nothing at all. Everything repository-derived is written with
`textContent`, never `innerHTML` — a commit subject is untrusted input, and a contributor who can
push can otherwise put `<img onerror=…>` into the maintainer's own chronicle. The injected JSON
escapes `<` as `\u003c` for the same reason, so a subject containing `</script>` cannot end the
data block. Both are covered by tests.

### ADR-012 — The passphrase is never a command-line flag

**Decision.** `egehan capsule` has no `--passphrase` option. The passphrase is typed at a prompt
with the echo suppressed, or supplied through `EGEHAN_PASSPHRASE` for automation, which the CLI
warns about when it uses it.

**Why.** A secret passed as an argument is written to the shell's history file and is visible to
every other process on the machine through the process list. For a passphrase that is supposed to
hold for a decade or two, and that cannot be reset, saving a few keystrokes is not worth it. The
unlock date is additionally bound into the ciphertext as AES-GCM additional authenticated data:
that does not make the date a security control — nothing could, on a file the reader holds — but it
makes an edited countdown _tamper-evident_, because the capsule then stops opening.

### ADR-010 — This repository carries no personal content

**Decision.** The project is named Egehan. Beyond the name, no dedication, letter or personal message is
committed to this repository, and the test suite asserts that the dictionaries stay impersonal.

**Why.** The repository is public and will stay public for a long time. A personal message committed into
it is a personal message published to everyone, permanently, and no encryption applied inside a published
file changes that (see ADR-005). The `dedication` field exists in `.egehanrc.json` for users who want one
in _their_ chronicle; it is opt-in and empty here.

## 3. Determinism, precisely

Narration must be reproducible across runtimes, so the rules leave nothing to interpretation:

| Concern            | Contract                                                                          |
| ------------------ | --------------------------------------------------------------------------------- |
| Variant choice     | `parseInt(sha.toLowerCase().slice(0, 8), 16) % variants.length`                   |
| Group choice       | the sha of the group's first commit                                               |
| Template filtering | `requires` placeholders must be non-empty; filter first, then index               |
| Wall clock         | only `generator.generatedAt` may depend on it; conformance comparisons exclude it |
| Ordering           | commits oldest-first; authors by first commit, then name; map keys sorted         |
| Floating point     | ratios are computed, then rounded for display only — never stored pre-rounded     |

## 4. Classification precedence

A commit is tested against every category. The first match in `evaluationOrder` becomes its primary
category; the rest become `secondaryCategories` and may contribute at most one modifier clause to the
sentence.

```text
milestone  ▸  birth  ▸  growing-pains  ▸  midnight-oil  ▸  first-steps  ▸  evolution
```

`evolution` is the documented fallback and is therefore last. A lone 03:18 fix becomes `midnight-oil`
with no `growing-pains` modifier, because `growing-pains` requires a _cluster_ — which is what makes the
worked example in the specification come out the way it does.

## 5. Where the risks are

Written down so they stay visible rather than becoming surprises:

- **Two engines drifting.** Mitigated by ADR-001 and the shared fixtures. This is the risk most likely to
  end the project, and the one the architecture is mostly shaped around.
- **Types drifting from the schema.** Mitigated by validating generated reports against the schema in CI.
- **Generated artifacts churning in git.** Mitigated by determinism, and by keeping the generation
  timestamp out of the rendered artifacts entirely (ADR-002). Regressions show up immediately as
  unexpected fixture diffs, and a test asserts the chronicle carries no timestamp.
- **Hook damage in user repositories.** Mitigated by ADR-006. Deserves the most careful tests in the
  project, because the failure mode lands in someone else's repository.
- **Web Crypto and Node disagreeing about the capsule.** The message would be unreadable in the
  one place it was meant to be read. Mitigated by a test that seals with `node:crypto` and opens
  through the Web Crypto API using the template's exact call sequence, and verified once by hand in
  a real browser.
- **The VSIX going stale.** It is the only deliverable that cannot be verified on the maintainer's
  machine. If it becomes unmaintainable, the honest move is to mark it unmaintained rather than ship
  something broken.
