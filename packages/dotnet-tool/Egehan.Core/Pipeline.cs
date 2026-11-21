using Egehan.Core.Capsule;
using Egehan.Core.Config;
using Egehan.Core.Detect;
using Egehan.Core.Engine;
using Egehan.Core.Git;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core;

/// <summary>
/// The one path from "a directory on disk" to "a finished report".
/// </summary>
/// <remarks>
/// Both the CLI and any embedder call this, which is the point: what a status bar says and what a
/// git hook writes must never be able to disagree.
/// </remarks>
public sealed class NotARepositoryException(string path) : InvalidOperationException(
    $"\"{path}\" is not inside a git repository. Egehan reads a project's story from its commits, "
    + "so there has to be a repository to read.");

public sealed class NoCommitsException() : InvalidOperationException(
    "This repository has no commits yet. Make the first one — that is the opening chapter.");

public sealed record ProduceOptions
{
    public required string WorkingDirectory { get; init; }
    public string? Since { get; init; }
    public string? Until { get; init; }
    public EgehanConfig? ConfigOverride { get; init; }
    public SealedCapsule? Capsule { get; init; }
    public string? GeneratedAt { get; init; }
    public int? MaxCommits { get; init; }
    public required string Version { get; init; }
}

public sealed record ProduceResult(EgehanReport Report, EgehanConfig Config, string RepositoryRoot);

public static class Pipeline
{
    public static ProduceResult Produce(ProduceOptions options)
    {
        var rules = EgehanRules.Load();
        var cwd = Path.GetFullPath(options.WorkingDirectory);
        var git = new GitRunner(cwd, rules);

        if (!Repository.IsGitRepository(git)) throw new NotARepositoryException(cwd);
        if (!Repository.HasAnyCommit(git)) throw new NoCommitsException();

        var repository = Repository.Read(git);
        var atRoot = git.At(repository.Root);

        var config = options.ConfigOverride ?? EgehanConfig.Load(repository.Root, rules);
        var history = LogReader.Read(atRoot, options.Since, options.Until, rules, options.MaxCommits);
        var projectTypes = ProjectTypes.Detect(ProjectTypes.Scan(repository.Root, rules), rules);

        var report = ReportBuilder.Build(new BuildReportInput
        {
            Commits = history.Commits,
            Project = new ProjectInfo
            {
                Name = config.ProjectName ?? repository.Name,
                Dedication = config.Dedication,
                DetectedTypes = projectTypes.DetectedTypes,
                Flavor = projectTypes.Flavor,
                DefaultBranch = repository.DefaultBranch,
                RemoteHost = repository.RemoteHost,
            },
            Config = new ReportConfig
            {
                Language = config.Language,
                Tone = config.Tone,
                RedactEmails = config.RedactEmails,
                AnonymizeAuthors = config.AnonymizeAuthors,
                IncludeMergeCommits = config.IncludeMergeCommits,
                Theme = config.Theme,
            },
            Since = options.Since,
            Until = options.Until,
            Truncated = history.Truncated,
            GeneratorVersion = options.Version,
            GeneratedAt = options.GeneratedAt ?? Timestamps.NowIso(),
            // A repository's own capsule is picked up without being asked for: the point of
            // sealing one is that it rides along with every chronicle from then on.
            Capsule = options.Capsule ?? CapsuleStorage.Load(repository.Root, rules),
        });

        return new ProduceResult(report, config, repository.Root);
    }
}
