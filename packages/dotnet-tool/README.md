# Egehan for .NET

The .NET half of a contract shared with the Node implementation. `Egehan.Core` is the story
engine; `Egehan.Cli` will be the `dotnet tool` that wraps it.

## Why two engines at all

Frontend and mobile teams live in npm; backend teams live in NuGet. Asking a .NET shop to install
Node to read its own history is asking them not to bother. So the engine exists twice — and the
only way two implementations of one thing stay honest is if "they agree" is something a build can
prove.

That proof is `Egehan.Core.Tests`. It loads the fixtures in `packages/core-spec/fixtures`, runs
this engine over them, and compares the result to the report the Node engine produced for the same
input. Two fields are excluded and only two: `generator.platform`, which the engines are supposed
to disagree about, and `generator.generatedAt`, the one field allowed to depend on when a report
was made.

## Building

```bash
dotnet test packages/dotnet-tool/Egehan.sln
```

Both `net8.0` and `net10.0` ship. On a machine with only one of the two SDKs:

```bash
dotnet test packages/dotnet-tool/Egehan.sln -p:TargetFrameworks=net8.0 -f net8.0
```

## What lives where

|                      |                                                                          |
| -------------------- | ------------------------------------------------------------------------ |
| `Model/`             | The C# mirror of the report schema                                       |
| `Spec/`              | The embedded contract: rules, dictionaries, template, and their loaders  |
| `Engine/`            | Timestamps, commit parsing, classification, narration, pulse, milestones |
| `Egehan.Core.Tests/` | The conformance suite, and the tests that prove it can fail              |

Nothing in `Engine/` may hard-code a threshold. Every number comes from `spec/rules.json`, which
is embedded straight out of `packages/core-spec` — the same bytes the Node engine reads.
