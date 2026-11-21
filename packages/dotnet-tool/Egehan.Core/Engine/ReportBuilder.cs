using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// Assembles the report.
/// </summary>
/// <remarks>
/// The only place that knows the whole pipeline, and deliberately boring: each stage is a pure
/// function of the one before it, and nothing here reads the filesystem, spawns a process or
/// looks at the clock. <c>generatedAt</c> arrives as an argument rather than being read here,
/// which is what lets the conformance suite compare this engine's output with the Node one.
/// </remarks>
public sealed record BuildReportInput
{
    public required IReadOnlyList<NormalizedCommit> Commits { get; init; }
    public required ProjectInfo Project { get; init; }
    public required ReportConfig Config { get; init; }
    public string? Since { get; init; }
    public string? Until { get; init; }
    public bool Truncated { get; init; }
    public required string GeneratorVersion { get; init; }
    public required string GeneratedAt { get; init; }
    public SealedCapsule? Capsule { get; init; }
}

public sealed class EmptyHistoryException(string message) : InvalidOperationException(message);

public static class ReportBuilder
{
    private static readonly string[] AllCategories =
        ["birth", "first-steps", "growing-pains", "midnight-oil", "milestone", "evolution"];

    public static EgehanReport Build(BuildReportInput input)
    {
        var rules = EgehanRules.Load();
        var dictionary = NarrativeDictionary.Load(input.Config.Language);

        var commits = input.Config.IncludeMergeCommits
            ? input.Commits
            : input.Commits.Where(commit => commit.Parents.Count <= 1).ToList();

        if (commits.Count == 0)
        {
            throw new EmptyHistoryException(input.Commits.Count == 0
                ? "This range contains no commits, so there is no story to tell yet."
                : "This range contains only merge commits. Pass --include-merges to narrate them.");
        }

        var prepared = Prepare.Commits(
            commits, rules, new PrepareOptions(input.Config.Language, input.Config.RedactEmails));

        var authors = Privacy.BuildAuthors(
            commits,
            rules,
            new PrivacyOptions(input.Config.RedactEmails, input.Config.AnonymizeAuthors, input.Config.Language));

        var context = new NarrationContext(
            dictionary, rules, input.Config.Tone, input.Config.Language, input.Project.Flavor);

        var classifications = Classifier.Classify(prepared, rules);

        var entries = prepared.Select(commit =>
        {
            var classification = Chapters.ClassificationFor(classifications, commit);
            var author = authors.Of(commit.Source);
            var narrated = Narrator.NarrateEntry(
                commit, classification.Category, classification.SecondaryCategories, author.DisplayName, context);

            return new ReportEntry
            {
                Sha = commit.Source.Sha,
                ShortSha = commit.Source.Sha[..7],
                Parents = commit.Source.Parents,
                AuthorId = author.Id,
                AuthoredAt = commit.Source.AuthoredAt,
                CommittedAt = commit.Source.CommittedAt,
                TzOffsetMinutes = commit.AuthoredAt.OffsetMinutes,
                LocalHour = commit.AuthoredAt.Hour,
                LocalWeekday = commit.AuthoredAt.Weekday,
                Subject = commit.Subject,
                CleanSubject = commit.CleanSubject,
                Conventional = commit.Conventional,
                Tags = commit.Tags,
                Stats = new EntryStats
                {
                    FilesCount = commit.FilesCount,
                    Insertions = commit.Insertions,
                    Deletions = commit.Deletions,
                    SizeBucket = commit.SizeBucket,
                },
                Category = classification.Category,
                SecondaryCategories = classification.SecondaryCategories,
                Narrative = narrated.Narrative,
                IsMerge = commit.IsMerge,
                VariantIndex = narrated.VariantIndex,
            };
        }).ToList();

        var chapters = Chapters.Group(prepared, classifications, rules)
            .Select((group, index) => ToChapter(group, index, authors, context))
            .ToList();

        var pulse = PulseCalculator.Compute(prepared, rules, context);
        var milestones = MilestoneCalculator.Compute(prepared, pulse, rules, context);

        var firstCommit = prepared[0];
        var lastCommit = prepared[^1];

        return new EgehanReport
        {
            SchemaVersion = rules.SchemaVersion,
            Generator = new GeneratorInfo
            {
                Version = input.GeneratorVersion,
                SpecVersion = rules.SpecVersion,
                DictionaryVersion = dictionary.Version,
                GeneratedAt = input.GeneratedAt,
            },
            Project = input.Project,
            Config = input.Config,
            Range = new RangeInfo
            {
                Since = input.Since,
                Until = input.Until,
                FirstCommitAt = firstCommit.Source.AuthoredAt,
                LastCommitAt = lastCommit.Source.AuthoredAt,
                Days = Timestamps.InclusiveDaySpan(firstCommit.AuthoredAt, lastCommit.AuthoredAt),
                Truncated = input.Truncated,
            },
            Totals = ComputeTotals(prepared, entries, authors.Authors.Count),
            Authors = authors.Authors,
            Chapters = chapters,
            Entries = entries,
            Pulse = pulse,
            Milestones = milestones,
            Capsule = input.Capsule,
        };
    }

    private static ReportChapter ToChapter(
        ChapterGroup group,
        int index,
        Privacy.AuthorIndex authors,
        NarrationContext context)
    {
        var first = group.Commits[0];
        var last = group.Commits[^1];

        var files = new HashSet<string>(StringComparer.Ordinal);
        var authorIds = new HashSet<string>(StringComparer.Ordinal);
        var insertions = 0;
        var deletions = 0;

        foreach (var commit in group.Commits)
        {
            insertions += commit.Insertions;
            deletions += commit.Deletions;
            authorIds.Add(authors.Of(commit.Source).Id);
            foreach (var file in commit.Source.Files) files.Add(file.Path);
        }

        var narrated = Narrator.NarrateChapter(
            new ChapterFacts(
                group.Category,
                group.Commits.Count,
                insertions,
                deletions,
                files.Count,
                authorIds.Count,
                first.AuthoredAt,
                last.AuthoredAt,
                first.Source.Sha),
            context);

        return new ReportChapter
        {
            Id = $"chapter-{(index + 1).ToString("D3", System.Globalization.CultureInfo.InvariantCulture)}",
            Category = group.Category,
            Title = narrated.Title,
            Narrative = narrated.Narrative,
            From = first.Source.AuthoredAt,
            To = last.Source.AuthoredAt,
            EntryShas = group.Commits.Select(commit => commit.Source.Sha).ToList(),
            Stats = new ChapterStats
            {
                Commits = group.Commits.Count,
                Insertions = insertions,
                Deletions = deletions,
                FilesCount = files.Count,
                // Sorted, because a set's iteration order is an implementation detail and this
                // value is compared across engines.
                AuthorIds = authorIds.OrderBy(id => id, StringComparer.Ordinal).ToList(),
            },
        };
    }

    private static Totals ComputeTotals(
        IReadOnlyList<PreparedCommit> prepared,
        IReadOnlyList<ReportEntry> entries,
        int authorCount)
    {
        var files = new HashSet<string>(StringComparer.Ordinal);
        var byCategory = AllCategories.ToDictionary(category => category, _ => 0, StringComparer.Ordinal);
        var byType = new Dictionary<string, int>(StringComparer.Ordinal);

        var insertions = 0;
        var deletions = 0;
        var tags = 0;
        var mergeCommits = 0;

        foreach (var commit in prepared)
        {
            insertions += commit.Insertions;
            deletions += commit.Deletions;
            tags += commit.Tags.Count;
            if (commit.IsMerge) mergeCommits += 1;
            foreach (var file in commit.Source.Files) files.Add(file.Path);

            byType[commit.Conventional.Type] = byType.GetValueOrDefault(commit.Conventional.Type) + 1;
        }

        foreach (var entry in entries) byCategory[entry.Category] += 1;

        return new Totals
        {
            Commits = prepared.Count,
            Authors = authorCount,
            Insertions = insertions,
            Deletions = deletions,
            FilesTouched = files.Count,
            Tags = tags,
            MergeCommits = mergeCommits,
            ByCategory = byCategory,
            ByType = byType,
        };
    }
}
