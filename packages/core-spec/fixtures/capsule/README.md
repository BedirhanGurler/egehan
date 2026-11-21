# Capsule interop fixture

`sealed-by-node.json` was produced by the Node engine. Its passphrase is
`conformance-test-passphrase`, written down on purpose: the file exists so every other engine can
prove it opens what Node sealed, and a secret nobody knows would make it useless.

The message inside is a test string and nothing else. Real capsules are never committed — the
default `.gitignore` entry and the CLI's own warning both say so.

Why this file is here at all: the capsule has to survive three implementations of the same
parameters — `node:crypto` seals it, the browser's Web Crypto opens it from the generated page,
and `System.Security.Cryptography` opens it from the .NET tool. A disagreement about any of
PBKDF2's inputs, the AES-GCM tag placement or the additional authenticated data would make
somebody's letter unreadable in the one place they meant to read it, and each engine's own tests
would pass while that was true.
