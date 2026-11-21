using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// Groups commits into chapters, so the chronicle reads as a story instead of a list.
/// </summary>
/// <remarks>
/// A chapter is a run of consecutive commits sharing a primary category. Two rules break a run
/// early, both from <c>rules.json → chapters</c>: a chapter never grows past
/// <c>maxEntriesPerChapter</c>, and a gap longer than <c>maxGapHoursWithinChapter</c> starts a new
/// one — a project that lay dormant for three months and then saw more evolution commits lived
/// through two periods, not one.
/// </remarks>
public sealed record ChapterGroup(string Category, IReadOnlyList<PreparedCommit> Commits);

public static class Chapters
{
    public static IReadOnlyList<ChapterGroup> Group(
        IReadOnlyList<PreparedCommit> commits,
        IReadOnlyDictionary<string, Classification> classifications,
        EgehanRules rules)
    {
        var groups = new List<ChapterGroup>();
        string? currentCategory = null;
        List<PreparedCommit>? current = null;

        foreach (var commit in commits)
        {
            var category = ClassificationFor(classifications, commit).Category;

            if (current is not null && currentCategory is not null)
            {
                var previous = current[^1];
                var continues = currentCategory == category
                    && current.Count < rules.Chapters.MaxEntriesPerChapter
                    && Timestamps.HoursBetween(previous.AuthoredAt, commit.AuthoredAt)
                        <= rules.Chapters.MaxGapHoursWithinChapter;

                if (continues)
                {
                    current.Add(commit);
                    continue;
                }

                groups.Add(new ChapterGroup(currentCategory, current));
            }

            currentCategory = category;
            current = [commit];
        }

        if (current is not null && currentCategory is not null)
        {
            groups.Add(new ChapterGroup(currentCategory, current));
        }

        return groups;
    }

    public static Classification ClassificationFor(
        IReadOnlyDictionary<string, Classification> classifications,
        PreparedCommit commit)
        => classifications.TryGetValue(commit.Source.Sha, out var classification)
            ? classification
            : throw new InvalidOperationException($"Commit {commit.Source.Sha} was never classified.");
}
