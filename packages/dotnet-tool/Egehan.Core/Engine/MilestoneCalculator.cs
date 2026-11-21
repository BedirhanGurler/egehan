using System.Globalization;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// The moments worth remembering.
/// </summary>
/// <remarks>
/// Restraint matters more than completeness: a strip listing two hundred entries is not a
/// milestone strip. The thresholds live in the rules file, and the one potentially repetitive
/// event — a fix in the small hours — is recorded only the first time it happens.
/// </remarks>
public static class MilestoneCalculator
{
    private static readonly string[] KindOrder =
    [
        "first-commit",
        "release-tag",
        "architectural-leap",
        "commit-count",
        "anniversary",
        "streak",
        "midnight-fix",
    ];

    public static IReadOnlyList<Milestone> Compute(
        IReadOnlyList<PreparedCommit> commits,
        Pulse pulse,
        EgehanRules rules,
        NarrationContext context)
    {
        if (commits.Count == 0) return [];

        var first = commits[0];
        var spec = rules.MilestoneCelebrations;
        var dictionary = context.Dictionary;
        var milestones = new List<Milestone>();

        void Push(string kind, string at, object? value, string? sha, string label)
            => milestones.Add(new Milestone
            {
                Kind = kind,
                At = at,
                Label = label,
                Value = value,
                Sha = sha,
                Narrative = Narrate(kind, value, dictionary),
            });

        Push("first-commit", first.Source.AuthoredAt, null, first.Source.Sha, CategoryLabel(dictionary, "birth"));

        foreach (var threshold in spec.CommitCounts)
        {
            if (threshold == 1 || threshold > commits.Count) continue;
            var commit = commits[threshold - 1];
            Push(
                "commit-count",
                commit.Source.AuthoredAt,
                threshold,
                commit.Source.Sha,
                Narrator.FormatUnit(threshold, dictionary.Units.Commit, dictionary));
        }

        if (spec.OnReleaseTag)
        {
            foreach (var commit in commits)
            {
                foreach (var tag in commit.ReleaseTags)
                {
                    Push("release-tag", commit.Source.AuthoredAt, tag, commit.Source.Sha, tag);
                }
            }
        }

        if (rules.Categories("milestone")?.LargeInsertionThreshold is { } leapThreshold)
        {
            foreach (var commit in commits.Where(commit => commit.Insertions >= leapThreshold))
            {
                Push(
                    "architectural-leap",
                    commit.Source.AuthoredAt,
                    commit.Insertions,
                    commit.Source.Sha,
                    Narrator.FormatUnit(commit.Insertions, dictionary.Units.Line, dictionary));
            }
        }

        foreach (var day in spec.AnniversaryDays)
        {
            // The commit that first carried the project past that many days of life. A project
            // younger than the threshold simply has not reached it.
            var reached = commits.FirstOrDefault(
                commit => Timestamps.InclusiveDaySpan(first.AuthoredAt, commit.AuthoredAt) >= day);
            if (reached is null) continue;

            Push(
                "anniversary",
                reached.Source.AuthoredAt,
                day,
                reached.Source.Sha,
                Narrator.FormatUnit(day, dictionary.Units.Day, dictionary));
        }

        foreach (var days in spec.OnStreakDays)
        {
            if (pulse.LongestStreak.Days < days || pulse.LongestStreak.To is null) continue;

            var endOfStreak = commits.FirstOrDefault(
                commit => commit.AuthoredAt.DayKey == pulse.LongestStreak.To);
            if (endOfStreak is null) continue;

            Push(
                "streak",
                endOfStreak.Source.AuthoredAt,
                days,
                endOfStreak.Source.Sha,
                Narrator.FormatUnit(days, dictionary.Units.Day, dictionary));
        }

        if (spec.OnMidnightFix
            && rules.Categories("midnight-oil") is { LocalHourFrom: { } from, LocalHourTo: { } to })
        {
            var fixes = commits
                .Where(commit => commit.Conventional.Type == "fix"
                    && commit.AuthoredAt.Hour >= from
                    && commit.AuthoredAt.Hour <= to)
                .ToList();

            var recorded = spec.MidnightFixMilestone == "first-only" ? fixes.Take(1) : fixes;

            foreach (var commit in recorded)
            {
                Push(
                    "midnight-fix",
                    commit.Source.AuthoredAt,
                    null,
                    commit.Source.Sha,
                    CategoryLabel(dictionary, "midnight-oil"));
            }
        }

        // Chronological, with a declared tie-break so two engines cannot order the same instant
        // differently. The final comparison is ordinal rather than culture-aware: a locale-aware
        // sort would make the order depend on the machine's culture, which is the one thing
        // determinism forbids.
        return milestones
            .OrderBy(milestone => Timestamps.Parse(milestone.At).EpochMs)
            .ThenBy(milestone => Array.IndexOf(KindOrder, milestone.Kind))
            .ThenBy(milestone => ValueText(milestone.Value), StringComparer.Ordinal)
            .ToList();
    }

    private static string ValueText(object? value) => value switch
    {
        null => "",
        int number => number.ToString(CultureInfo.InvariantCulture),
        _ => value.ToString() ?? "",
    };

    private static string Narrate(string kind, object? value, NarrativeDictionary dictionary)
        => dictionary.Milestones.For(kind).Replace("{value}", ValueText(value), StringComparison.Ordinal);

    private static string CategoryLabel(NarrativeDictionary dictionary, string category)
        => dictionary.Categories.TryGetValue(category, out var narratives)
            ? narratives.Label
            : throw new InvalidOperationException($"The dictionary has no label for category \"{category}\".");
}
