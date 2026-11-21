namespace Egehan.Core.Git;

/// <summary>Facts about the repository that the report records but the engine does not reason about.</summary>
public sealed record RepositoryInfo(string Root, string Name, string? DefaultBranch, string? RemoteHost);

public static class Repository
{
    public static bool IsGitRepository(GitRunner git) => git.Try("rev-parse", "--git-dir").ExitCode == 0;

    public static bool HasAnyCommit(GitRunner git) => git.Try("rev-parse", "--verify", "HEAD").ExitCode == 0;

    public static RepositoryInfo Read(GitRunner git)
    {
        var root = Path.GetFullPath(git.Run("rev-parse", "--show-toplevel").Trim());

        return new RepositoryInfo(
            Root: root,
            Name: new DirectoryInfo(root).Name,
            DefaultBranch: ReadDefaultBranch(git),
            RemoteHost: ReadRemoteHost(git));
    }

    private static string? ReadDefaultBranch(GitRunner git)
    {
        var remoteHead = git.Try("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
        if (remoteHead.ExitCode == 0)
        {
            var value = remoteHead.StandardOutput.Trim();
            var branch = value.StartsWith("origin/", StringComparison.Ordinal) ? value["origin/".Length..] : value;
            if (branch.Length > 0) return branch;
        }

        var current = git.Try("rev-parse", "--abbrev-ref", "HEAD");
        var name = current.StandardOutput.Trim();
        return current.ExitCode == 0 && name.Length > 0 && name != "HEAD" ? name : null;
    }

    /// <summary>
    /// The remote's host only.
    /// </summary>
    /// <remarks>
    /// A full remote URL can embed a token, and this value ends up in a file people publish.
    /// Recording the host keeps the useful part — which forge the project lives on — and leaves
    /// no room for a credential to ride along.
    /// </remarks>
    private static string? ReadRemoteHost(GitRunner git)
    {
        var result = git.Try("remote", "get-url", "origin");
        if (result.ExitCode != 0) return null;

        var url = result.StandardOutput.Trim();
        if (url.Length == 0) return null;

        var scp = System.Text.RegularExpressions.Regex.Match(url, @"^[^@/]+@([^:/]+):");
        if (scp.Success) return scp.Groups[1].Value;

        return Uri.TryCreate(url, UriKind.Absolute, out var parsed) && parsed.Host.Length > 0 ? parsed.Host : null;
    }

    public static bool IsRevision(GitRunner git, string value)
        => git.Try("rev-parse", "--verify", "--quiet", $"{value}^{{commit}}").ExitCode == 0;
}
