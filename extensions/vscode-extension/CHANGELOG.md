# Changelog

## 0.1.0 — unreleased

The first release.

- Status bar entry with the project's age, commit count and a pulse tooltip, in the chronicle's
  own language.
- Interactive timeline in an editor tab, served under a strict Content-Security-Policy with a
  per-panel nonce and no network access of any kind.
- Milestone notifications, silent on the first run so an existing repository's history is recorded
  rather than announced.
- Commands for writing the chronicle files and for installing or removing the git hooks.
- Refreshes when `HEAD` moves, debounced, with a configurable ceiling on how much history is read.
