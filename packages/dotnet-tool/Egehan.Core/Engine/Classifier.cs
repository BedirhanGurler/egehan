using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// Places every commit in a chapter of the story.
/// </summary>
/// <remarks>
/// A commit is tested against all six categories. The first match in
/// <c>classification.evaluationOrder</c> becomes its primary category; the rest become secondary,
/// and a secondary that is also a modifier category can contribute one extra clause to the
/// sentence. That is how a deletion-heavy 02:41 refactor comes out as growing pains that also
/// happened in the middle of the night, rather than having to pick one truth.
///
/// Every threshold is read from the rules file. There is no number in here that the Node engine
/// could not also see.
/// </remarks>
public sealed record Classification(string Category, IReadOnlyList<string> SecondaryCategories);

public static class Classifier
{
    private sealed record Context(
        PreparedCommit? First,
        int FirstReleaseIndex,
        HashSet<string> ClusteredFixShas);

    public static IReadOnlyDictionary<string, Classification> Classify(
        IReadOnlyList<PreparedCommit> commits,
        EgehanRules rules)
    {
        var order = rules.Classification.EvaluationOrder;
        var modifiers = new HashSet<string>(rules.Classification.ModifierCategories, StringComparer.Ordinal);

        var context = BuildContext(commits, rules);
        var result = new Dictionary<string, Classification>(StringComparer.Ordinal);

        foreach (var commit in commits)
        {
            var matches = order.Where(category => Matches(category, commit, context, rules)).ToList();
            if (matches.Count == 0) matches.Add("evolution");

            result[commit.Source.Sha] = new Classification(
                matches[0],
                // Only modifier categories survive: a secondary nobody can express in a sentence
                // is noise in the report, and the filters read the primary category anyway.
                matches.Skip(1).Where(modifiers.Contains).ToList());
        }

        return result;
    }

    private static Context BuildContext(IReadOnlyList<PreparedCommit> commits, EgehanRules rules)
    {
        var firstRelease = -1;
        for (var index = 0; index < commits.Count; index += 1)
        {
            if (commits[index].ReleaseTags.Count > 0)
            {
                firstRelease = index;
                break;
            }
        }

        return new Context(
            commits.Count > 0 ? commits[0] : null,
            firstRelease == -1 ? int.MaxValue : firstRelease,
            FindFixClusters(commits, rules));
    }

    /// <summary>
    /// Finds the fix commits that belong to a burst.
    /// </summary>
    /// <remarks>
    /// "At least three fixes inside forty-eight hours" is a sliding window over the fix commits
    /// only: any run of <c>minFixCommitsInCluster</c> consecutive fixes whose first and last fall
    /// inside <c>clusterWindowHours</c> marks every fix in that run. Expressed this way it is
    /// order-stable and trivially portable — no graph walking, no dates compared across zones.
    /// </remarks>
    private static HashSet<string> FindFixClusters(IReadOnlyList<PreparedCommit> commits, EgehanRules rules)
    {
        var clustered = new HashSet<string>(StringComparer.Ordinal);
        var spec = rules.Categories("growing-pains");

        if (spec?.ClusterWindowHours is not { } window) return clustered;
        if (spec.MinFixCommitsInCluster is not { } minimum || minimum < 1) return clustered;

        var fixTypes = new HashSet<string>(spec.ClusterFixTypes ?? [], StringComparer.Ordinal);
        var fixes = commits.Where(commit => fixTypes.Contains(commit.Conventional.Type)).ToList();

        for (var start = 0; start + minimum - 1 < fixes.Count; start += 1)
        {
            var head = fixes[start];
            var tail = fixes[start + minimum - 1];

            if (Timestamps.HoursBetween(head.AuthoredAt, tail.AuthoredAt) <= window)
            {
                for (var offset = 0; offset < minimum; offset += 1)
                {
                    clustered.Add(fixes[start + offset].Source.Sha);
                }
            }
        }

        return clustered;
    }

    private static bool Matches(string category, PreparedCommit commit, Context context, EgehanRules rules)
    {
        var spec = rules.Categories(category);
        if (spec is null) return false;

        switch (category)
        {
            case "milestone":
                if (commit.ReleaseTags.Count > 0) return true;
                if (spec.BreakingChangeMatches == true && commit.Conventional.Breaking) return true;
                return spec.LargeInsertionThreshold is { } threshold && commit.Insertions >= threshold;

            case "birth":
                if (context.First is null) return false;
                if (spec.FirstCommitAlwaysMatches == true && commit.Index == 0) return true;
                if (spec.SetupWindowHours is not { } window) return false;

                return Timestamps.HoursBetween(context.First.AuthoredAt, commit.AuthoredAt) <= window
                    && (spec.SetupWindowAppliesToTypes ?? []).Contains(commit.Conventional.Type);

            case "growing-pains":
                if (context.ClusteredFixShas.Contains(commit.Source.Sha)) return true;
                if (spec.RefactorDeletionRatio is not { } ratio) return false;
                if (spec.RefactorMinChangedLines is not { } minimum) return false;

                return commit.Deletions > commit.Insertions * ratio && commit.ChangedLines >= minimum;

            case "midnight-oil":
                if (spec.LocalHourFrom is not { } from || spec.LocalHourTo is not { } to) return false;
                return commit.AuthoredAt.Hour >= from && commit.AuthoredAt.Hour <= to;

            case "first-steps":
                if (spec.RequiresNoReleaseTagBefore == true && commit.Index >= context.FirstReleaseIndex) return false;
                return (spec.Types ?? []).Contains(commit.Conventional.Type);

            case "evolution":
                return spec.IsFallback == true || (spec.Types ?? []).Contains(commit.Conventional.Type);

            default:
                // Reaching here means a category was added to the rules without teaching the
                // classifier what it means, which must fail loudly rather than silently classify
                // everything as evolution.
                throw new InvalidOperationException($"No classification logic for category \"{category}\".");
        }
    }
}
