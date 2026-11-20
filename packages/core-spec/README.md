# @egehan/core-spec

The language-agnostic contract that every Egehan implementation obeys. **This package contains no
implementation code on purpose.** It is data, and only data:

| Path                               | What it is                                                                                         | Who reads it                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `schema/egehan-report.schema.json` | JSON Schema (2020-12) of the chronicle report                                                      | every engine, every renderer, CI      |
| `spec/rules.json`                  | The engine contract: classification thresholds, determinism formula, privacy and crypto parameters | every engine                          |
| `dictionary/narratives.*.json`     | Narrative templates per language, three tones each                                                 | every engine                          |
| `templates/egehan-book.html`       | The single-file interactive timeline template                                                      | every renderer                        |
| `fixtures/`                        | Golden input → expected output pairs                                                               | the conformance suite of every engine |

## Why no code lives here

Egehan ships two engines today (Node and .NET) and should be portable to any runtime tomorrow. If the
classification thresholds or the narrative templates lived inside one of those engines, that engine would
silently become the specification and the other would drift behind it. Keeping the rules in data means
"the two engines agree" is a property CI can _prove_, not a promise a maintainer has to keep.

## Adding a language

Copy `dictionary/narratives.en.json` to `dictionary/narratives.<code>.json`, translate the strings, and run:

```bash
npm run validate -w @egehan/core-spec
```

The validator refuses a language file whose structure does not mirror the reference, and refuses any
template that interpolates a placeholder the engine does not provide. Both engines then pick the new
language up with no code change.

## Changing a rule

Any change to `spec/rules.json` or to a dictionary changes the output of _both_ engines, which is the
point. Bump `specVersion` / `version` accordingly, regenerate the fixtures, and expect the conformance
tests of every engine to be the thing that tells you whether the change was safe.
