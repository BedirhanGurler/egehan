using Egehan.Core.Model;
using Egehan.Core.Spec;
using System.Text.RegularExpressions;

namespace Egehan.Core.Engine;

/// <summary>
/// Everything the later stages need about a commit, computed once.
/// </summary>
/// <remarks>
/// Classification, narration, chapter grouping and the pulse all want the same derived facts.
/// Deriving them in one place means they cannot disagree with each other, and it keeps the
/// stages that follow readable: a classifier that also parses timestamps is a classifier nobody
/// can review.
/// </remarks>
public sealed record PreparedCommit
{
    public required int Index { get; init; }
    public required NormalizedCommit Source { get; init; }
    public required LocalTimestamp AuthoredAt { get; init; }
    public required LocalTimestamp CommittedAt { get; init; }
    public required string Subject { get; init; }
    public required string CleanSubject { get; init; }
    public required ConventionalInfo Conventional { get; init; }
    public required int Insertions { get; init; }
    public required int Deletions { get; init; }
    public int ChangedLines => Insertions + Deletions;
    public required int FilesCount { get; init; }
    public required string SizeBucket { get; init; }
    public IReadOnlyList<string> Tags { get; init; } = [];

    /// <summary>The subset of <see cref="Tags"/> that look like a release.</summary>
    public IReadOnlyList<string> ReleaseTags { get; init; } = [];

    public required bool IsMerge { get; init; }
}

public sealed record PrepareOptions(string Language, bool RedactEmails);

public static class Prepare
{
    public static IReadOnlyList<PreparedCommit> Commits(
        IReadOnlyList<NormalizedCommit> commits,
        EgehanRules rules,
        PrepareOptions options)
    {
        var tagPattern = new Regex(RequireTagPattern(rules));
        var prepared = new List<PreparedCommit>(commits.Count);

        for (var index = 0; index < commits.Count; index += 1)
        {
            var commit = commits[index];
            var parsed = ConventionalCommits.ParseSubject(commit, rules, options.Language);

            var insertions = commit.Files.Sum(file => file.Insertions);
            var deletions = commit.Files.Sum(file => file.Deletions);

            var subject = options.RedactEmails ? Privacy.RedactEmailsIn(commit.Subject, rules) : commit.Subject;
            var cleaned = options.RedactEmails
                ? Privacy.RedactEmailsIn(parsed.CleanSubject, rules)
                : parsed.CleanSubject;

            prepared.Add(new PreparedCommit
            {
                Index = index,
                Source = commit,
                AuthoredAt = Timestamps.Parse(commit.AuthoredAt),
                CommittedAt = Timestamps.Parse(commit.CommittedAt),
                Subject = subject,
                CleanSubject = cleaned,
                Conventional = parsed.Conventional,
                Insertions = insertions,
                Deletions = deletions,
                FilesCount = commit.Files.Count,
                SizeBucket = BucketFor(insertions + deletions, rules),
                Tags = commit.Tags,
                ReleaseTags = commit.Tags.Where(tag => tagPattern.IsMatch(tag)).ToList(),
                IsMerge = commit.Parents.Count > 1,
            });
        }

        return prepared;
    }

    private static string BucketFor(int changedLines, EgehanRules rules)
    {
        foreach (var bucket in rules.Pulse.SizeBuckets)
        {
            if (bucket.MaxChangedLines is null || changedLines <= bucket.MaxChangedLines) return bucket.Id;
        }

        throw new InvalidOperationException("rules.json → pulse.sizeBuckets has no open-ended final bucket.");
    }

    public static string RequireTagPattern(EgehanRules rules)
        => rules.Categories("milestone")?.TagPattern
            ?? throw new InvalidOperationException(
                "rules.json → classification.categories.milestone.tagPattern is missing.");
}
