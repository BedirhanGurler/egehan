using Egehan.Core.Git;
using Egehan.Core.Spec;

namespace Egehan.Core.Hooks;

/// <summary>
/// Deciding where a hook goes, and putting it there without breaking what is already set up.
/// </summary>
/// <remarks>
/// Most repositories that would want Egehan already run something on commit, and taking over
/// <c>.git/hooks</c> is the one behaviour guaranteed to get the tool uninstalled. So this is
/// mostly deference: find out who owns the hooks, then fit in alongside them or step back and say
/// what to add by hand (docs/ARCHITECTURE.md, ADR-006).
/// </remarks>
public enum HookOwner
{
    Git,
    Husky,
    Lefthook,
}

public enum HookAction
{
    Created,
    Updated,
    Unchanged,
    Removed,
    Absent,
    Skipped,
}

public sealed record HookTarget(HookOwner Owner, string Directory, string? ConfiguredHooksPath, string Explanation);

public sealed record HookWriteResult(string Hook, string Path, HookAction Action);

public sealed record HookStatus(string Hook, string Path, bool Exists, bool Installed, bool SharedWithOtherHooks);

public static class HookManager
{
    private static readonly string[] LefthookConfigs =
    [
        "lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml", "lefthook.toml", "lefthook.json",
    ];

    /// <summary>
    /// Works out which directory git will actually read hooks from, and who is in charge of it.
    /// </summary>
    /// <remarks>
    /// <c>--absolute-git-dir</c>, never <c>--git-dir</c>: run from the repository root the latter
    /// answers a relative ".git", and resolving that against the process working directory
    /// installs the hook into whichever repository the tool itself is running from.
    /// </remarks>
    public static HookTarget ResolveTarget(GitRunner git, string root)
    {
        var configured = git.Try("config", "--get", "core.hooksPath");
        var hooksPath = configured.ExitCode == 0 && configured.StandardOutput.Trim().Length > 0
            ? configured.StandardOutput.Trim()
            : null;

        if (Directory.Exists(Path.Combine(root, ".husky")))
        {
            // Husky v8 points core.hooksPath at `.husky`, v9 at `.husky/_` where it regenerates
            // shims that call `.husky/<hook>`. In both, `.husky/<hook>` is the file a human owns,
            // and it survives `husky install`.
            return new HookTarget(
                HookOwner.Husky,
                Path.Combine(root, ".husky"),
                hooksPath,
                "Husky manages this repository, so the hook goes in .husky/ beside your own.");
        }

        if (DetectsLefthook(root, hooksPath))
        {
            // Lefthook regenerates its hook files on every install, so anything appended there
            // disappears without warning. Saying what to add is the honest answer.
            return new HookTarget(
                HookOwner.Lefthook,
                "",
                hooksPath,
                "Lefthook manages this repository and rewrites its hook files on every install.");
        }

        var directory = hooksPath is null
            ? Path.Combine(git.Run("rev-parse", "--absolute-git-dir").Trim(), "hooks")
            : (Path.IsPathRooted(hooksPath) ? hooksPath : Path.GetFullPath(Path.Combine(root, hooksPath)));

        return new HookTarget(
            HookOwner.Git,
            directory,
            hooksPath,
            hooksPath is null
                ? "Hooks live in the repository’s own hooks directory."
                : $"This repository sets core.hooksPath to \"{hooksPath}\".");
    }

    private static bool DetectsLefthook(string root, string? hooksPath)
    {
        if (LefthookConfigs.Any(name => File.Exists(Path.Combine(root, name)))) return true;
        if (hooksPath?.Contains("lefthook", StringComparison.Ordinal) == true) return true;

        return HookBlock.ManagedHooks.Any(hook =>
        {
            var path = Path.Combine(root, ".git", "hooks", hook);
            return File.Exists(path)
                && File.ReadAllText(path).Contains("LEFTHOOK", StringComparison.Ordinal);
        });
    }

    /// <summary>The lefthook configuration a user should add by hand.</summary>
    public static string LefthookSnippet() => string.Join('\n',
        "post-commit:",
        "  commands:",
        "    egehan:",
        "      run: egehan generate --quiet",
        "",
        "post-merge:",
        "  commands:",
        "    egehan:",
        "      run: egehan generate --quiet");

    public static IReadOnlyList<HookWriteResult> Install(HookTarget target, string version)
    {
        if (target.Owner == HookOwner.Lefthook)
        {
            return HookBlock.ManagedHooks.Select(hook => new HookWriteResult(hook, "", HookAction.Skipped)).ToList();
        }

        Directory.CreateDirectory(target.Directory);

        return HookBlock.ManagedHooks.Select(hook =>
        {
            var path = Path.Combine(target.Directory, hook);
            var existing = File.Exists(path) ? File.ReadAllText(path) : "";
            var updated = HookBlock.WithBlock(existing, HookBlock.Build(hook, version));

            if (existing == updated)
            {
                MakeExecutable(path);
                return new HookWriteResult(hook, path, HookAction.Unchanged);
            }

            File.WriteAllText(path, updated);
            MakeExecutable(path);

            return new HookWriteResult(
                hook, path, existing.Length == 0 ? HookAction.Created : HookAction.Updated);
        }).ToList();
    }

    public static IReadOnlyList<HookWriteResult> Uninstall(HookTarget target)
    {
        if (target.Owner == HookOwner.Lefthook)
        {
            return HookBlock.ManagedHooks.Select(hook => new HookWriteResult(hook, "", HookAction.Skipped)).ToList();
        }

        return HookBlock.ManagedHooks.Select(hook =>
        {
            var path = Path.Combine(target.Directory, hook);
            if (!File.Exists(path)) return new HookWriteResult(hook, path, HookAction.Absent);

            var existing = File.ReadAllText(path);
            if (!HookBlock.HasBlock(existing)) return new HookWriteResult(hook, path, HookAction.Absent);

            var remaining = HookBlock.WithoutBlock(existing);

            // Only delete a file with nothing of anyone else's left in it: a hook that still runs
            // somebody's linter must survive uninstalling this one.
            if (remaining.Length == 0 || HookBlock.IsEmptyScript(remaining))
            {
                File.Delete(path);
                return new HookWriteResult(hook, path, HookAction.Removed);
            }

            File.WriteAllText(
                path,
                remaining.StartsWith("#!", StringComparison.Ordinal) ? remaining : $"{HookBlock.Shebang}\n{remaining}");

            return new HookWriteResult(hook, path, HookAction.Updated);
        }).ToList();
    }

    public static IReadOnlyList<HookStatus> Status(HookTarget target)
        => HookBlock.ManagedHooks.Select(hook =>
        {
            var path = target.Owner == HookOwner.Lefthook ? "" : Path.Combine(target.Directory, hook);
            var exists = path.Length > 0 && File.Exists(path);
            var content = exists ? File.ReadAllText(path) : "";
            var installed = HookBlock.HasBlock(content);

            return new HookStatus(
                hook,
                path,
                exists,
                installed,
                installed && !HookBlock.IsEmptyScript(HookBlock.WithoutBlock(content)));
        }).ToList();

    private static void MakeExecutable(string path)
    {
        // Windows has no execute bit, and git for Windows runs hooks regardless. Guarding here
        // rather than catching the exception keeps the platform analyser satisfied, which is the
        // same analyser that would otherwise let a genuinely unsupported call through unnoticed.
        if (OperatingSystem.IsWindows()) return;

        try
        {
            var mode = File.GetUnixFileMode(path);
            File.SetUnixFileMode(path, mode | UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            // ignored on purpose
        }
    }
}
