# Releasing

Three artifacts, one version, one tag. Everything is published by
[`.github/workflows/release.yml`](.github/workflows/release.yml), which runs the whole test suite
first and refuses to publish anything if the three manifests disagree with the tag.

| Artifact         | Registry            | Name                           |
| ---------------- | ------------------- | ------------------------------ |
| CLI              | npm                 | `egehan`                       |
| CLI              | NuGet               | `Egehan.Cli`                   |
| Editor extension | VS Code Marketplace | `bedirhangurler.egehan-vscode` |

> Türkçe, adım adım anlatımı: [docs/YAYINLAMA.md](docs/YAYINLAMA.md)

## One-time setup

These need accounts and tokens, and nothing in the repository can create them for you.

### 1. npm

1. Create an account on [npmjs.com](https://www.npmjs.com/) and enable two-factor authentication.
2. Create a **Granular Access Token** with write access to the `egehan` package (or to all
   packages, if it does not exist yet), under _Access Tokens → Generate New Token_.
3. Add it to the repository as the secret **`NPM_TOKEN`**
   (_Settings → Secrets and variables → Actions_).

The workflow publishes with `--provenance`, so npm records which workflow run and which commit
produced the tarball, and shows a verified badge on the package page. That needs the
`id-token: write` permission the workflow already requests — nothing extra to configure.

### 2. NuGet

1. Create an account on [nuget.org](https://www.nuget.org/) and enable two-factor authentication.
2. Under _API Keys_, create a key scoped to **Push** for the package pattern `Egehan.*`.
3. Add it as the secret **`NUGET_API_KEY`**.

The first push of a brand-new package id can take a few minutes to index.

### 3. VS Code Marketplace

This one has the most steps, because it runs on Azure DevOps.

1. Create an [Azure DevOps](https://dev.azure.com/) organisation if you do not have one.
2. Create a **Personal Access Token** with _Marketplace → Manage_ scope, for **All accessible
   organizations**. A token scoped to a single organisation will not work.
3. Create the publisher at
   [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage), with the id
   **`bedirhangurler`** — it must match the `publisher` field in
   `extensions/vscode-extension/package.json`.
4. Add the token as the secret **`VSCE_PAT`**.

> The PAT expires, by default after a year. When a release fails on the VS Code job and nothing
> else changed, this is almost always why.

## Rehearsing

Before the first real release, run the workflow by hand with the dry run left on:

_Actions → Release → Run workflow → `dry-run: true`_

It builds and verifies everything, packs all three artifacts, uploads the `.nupkg` and the `.vsix`
as workflow artifacts, and publishes nothing. Download them and install them locally:

```bash
code --install-extension egehan.vsix
dotnet tool install -g --add-source ./ Egehan.Cli
```

## Releasing

```bash
# 1. Set the version everywhere at once
node scripts/set-version.mjs 0.1.0

# 2. Write what changed
$EDITOR CHANGELOG.md

# 3. Commit and tag
git add -A
git commit -m "chore(release): 0.1.0"
git tag v0.1.0
git push origin main --follow-tags
```

Pushing the tag is what starts the release. The workflow verifies, publishes to all three
registries, and creates a GitHub release with the `.nupkg` and `.vsix` attached.

## Afterwards

- `npm view egehan` — the version, and the provenance badge on the package page.
- `dotnet tool install -g Egehan.Cli` on a clean machine.
- The extension page on the Marketplace: icon, README, categories.
- Run `npx egehan` in a repository that is not this one.

## If something goes wrong

Each registry has different rules, and none of them is an undo button:

- **npm** allows unpublishing a version within 72 hours, and only if nothing depends on it.
  Afterwards, `npm deprecate` is the honest option, followed by a patch release.
- **NuGet** does not allow deleting a version at all. `dotnet nuget delete` only unlists it, which
  hides it from search while leaving it installable. Publish a patch.
- **VS Code Marketplace** lets you unpublish a version, and the extension page keeps a history.

Which is the real reason the workflow runs the whole suite before it publishes anything: for two
of the three, the release is permanent the moment it lands.
