# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/bedirhangurler/egehan/security/advisories/new)
rather than in a public issue. Expect an acknowledgement within a few days.

## What Egehan does and does not touch

Worth stating plainly, because the tool runs inside people's repositories:

- **No network access.** Egehan makes no requests of any kind, and has no telemetry. This is a
  correctness property of the design, not a setting.
- **Reads git, writes two files.** It invokes `git` read-only commands and writes `EGEHAN.md`,
  `egehan-chronicle.html` and `.egehanrc.json` where you tell it to.
- **Hooks never mutate your repository.** The installed `post-commit` and `post-merge` hooks regenerate
  artifacts. They never run `git add`, `git commit` or any other writing git command, and they no-op
  during rebase, merge and bisect.
- **E-mail addresses are redacted by default.** The generated artifacts carry a truncated SHA-256 of each
  author's address instead of the address itself, unless you explicitly disable redaction.

## The time capsule, honestly

`egehan capsule` uses PBKDF2-SHA-256 (600 000 iterations) to derive an AES-256-GCM key from a passphrase
of at least 12 characters. Within those parameters the ciphertext is as safe as the passphrase.

Be clear about the threat model, though: **the unlock date is not a security control.** The countdown in
the HTML timeline is a presentational ritual, and anyone can change their system clock or open the
browser console. The passphrase is the only thing protecting the contents. This is also why no
passphrase-free capsule mode exists — it would advertise encryption while providing none.

If you lose the passphrase, the message is unrecoverable. That is the intended behaviour, and the CLI
says so before it writes the file.

## Reports that are out of scope

- "The unlock date can be bypassed" — correct, and documented above. The passphrase is the lock.
- "The capsule hint is stored in cleartext" — correct, and the CLI warns at creation time.
- Findings that require an attacker who already has write access to your `.git/hooks` directory.
