using System.Globalization;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// The Developer Pulse: the shape of how somebody actually worked.
/// </summary>
/// <remarks>
/// Two properties are deliberate. Nothing here reads the wall clock — the current streak is the
/// run ending at the last commit in range, not at today, so the report does not change every
/// morning while the repository stands still. And every derived number is rounded to the
/// precision <c>rules.json → pulse.rounding</c> fixes, before it enters the report.
///
/// The rounding uses <see cref="MidpointRounding.AwayFromZero"/> on purpose: .NET rounds halves
/// to even by default, where JavaScript's <c>Math.round</c> rounds them up, and a single value
/// landing exactly on a half would otherwise split the two engines.
/// </remarks>
public static class PulseCalculator
{
    public static Pulse Compute(
        IReadOnlyList<PreparedCommit> commits,
        EgehanRules rules,
        NarrationContext context)
    {
        var hourHistogram = new int[24];
        var weekdayHistogram = new int[7];
        var monthly = new Dictionary<string, (int Commits, int Insertions, int Deletions)>(StringComparer.Ordinal);
        var dayKeys = new HashSet<string>(StringComparer.Ordinal);

        var insertions = 0;
        var deletions = 0;
        var changedLines = new List<int>(commits.Count);

        foreach (var commit in commits)
        {
            hourHistogram[commit.AuthoredAt.Hour] += 1;
            weekdayHistogram[commit.AuthoredAt.Weekday] += 1;
            dayKeys.Add(commit.AuthoredAt.DayKey);

            insertions += commit.Insertions;
            deletions += commit.Deletions;
            changedLines.Add(commit.ChangedLines);

            var key = commit.AuthoredAt.MonthKey;
            (int Commits, int Insertions, int Deletions) month =
                monthly.TryGetValue(key, out var existing) ? existing : default;
            monthly[key] = (month.Commits + 1, month.Insertions + commit.Insertions, month.Deletions + commit.Deletions);
        }

        var total = commits.Count;
        var chronotype = DetectChronotype(hourHistogram, total, rules);
        var (longest, current) = ComputeStreaks(dayKeys, rules);

        var pulse = new Pulse
        {
            Chronotype = chronotype,
            ChronotypeLabel = ChronotypeLabel(chronotype, context.Dictionary),
            HourHistogram = hourHistogram,
            WeekdayHistogram = weekdayHistogram,
            BusiestHour = SmoothedPeakIndex(hourHistogram, rules.Pulse.PeakSmoothingWindow),
            BusiestWeekday = PeakIndex(weekdayHistogram),
            CreationRatio = Round(
                insertions / (double)Math.Max(1, insertions + deletions), rules.Pulse.Rounding.RatioDecimals),
            AvgChangedLines = Round(
                changedLines.Sum() / (double)Math.Max(1, total), rules.Pulse.Rounding.AverageDecimals),
            MedianChangedLines = Round(Median(changedLines), rules.Pulse.Rounding.AverageDecimals),
            LongestStreak = longest,
            CurrentStreak = current,
            MonthlyActivity = monthly
                .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                .Select(entry => new MonthlyActivity
                {
                    Month = entry.Key,
                    Commits = entry.Value.Commits,
                    Insertions = entry.Value.Insertions,
                    Deletions = entry.Value.Deletions,
                })
                .ToList(),
            Narrative = "",
        };

        return pulse with { Narrative = Narrate(pulse, commits, context) };
    }

    /// <summary>
    /// Picks the chronotype whose hours carry the largest share, provided it clears
    /// <c>minShare</c>. Ties fall to declaration order, so the answer never depends on how a map
    /// happened to be iterated.
    /// </summary>
    private static string DetectChronotype(int[] hourHistogram, int total, EgehanRules rules)
    {
        if (total == 0) return rules.Pulse.FallbackChronotype;

        string? bestId = null;
        var bestShare = 0.0;

        foreach (var candidate in rules.Pulse.Chronotypes)
        {
            var share = candidate.Hours.Sum(hour => hourHistogram[hour]) / (double)total;
            if (share < candidate.MinShare) continue;
            if (bestId is null || share > bestShare)
            {
                bestId = candidate.Id;
                bestShare = share;
            }
        }

        return bestId ?? rules.Pulse.FallbackChronotype;
    }

    /// <summary>
    /// Longest and current runs of consecutive calendar days with at least one commit.
    /// </summary>
    /// <remarks>
    /// Days are compared as day keys in the commit's own timezone, so a developer who commits at
    /// 23:50 and again at 00:10 gets two days — which is what their calendar says.
    /// </remarks>
    private static (Streak Longest, Streak Current) ComputeStreaks(HashSet<string> dayKeys, EgehanRules rules)
    {
        var empty = new Streak { Days = 0, From = null, To = null };
        if (dayKeys.Count == 0) return (empty, empty);

        var sorted = dayKeys.OrderBy(key => key, StringComparer.Ordinal).ToList();
        var runs = new List<Streak>();

        var start = sorted[0];
        var previous = start;
        var length = 1;

        foreach (var day in sorted.Skip(1))
        {
            if (Timestamps.DayKeyDistance(previous, day) == 1)
            {
                length += 1;
            }
            else
            {
                runs.Add(new Streak { Days = length, From = start, To = previous });
                start = day;
                length = 1;
            }
            previous = day;
        }
        runs.Add(new Streak { Days = length, From = start, To = previous });

        var minimum = rules.Pulse.Streak.MinLengthToReport;
        var longest = runs.Aggregate(runs[0], (best, run) => run.Days > best.Days ? run : best);

        // The *current* streak is the last run in the history, never a run relative to today.
        var current = runs[^1];

        return (
            longest.Days >= minimum ? longest : empty,
            current.Days >= minimum ? current : empty);
    }

    private static string Narrate(Pulse pulse, IReadOnlyList<PreparedCommit> commits, NarrationContext context)
    {
        var dictionary = context.Dictionary;
        if (!dictionary.Pulse.Chronotypes.TryGetValue(pulse.Chronotype, out var chronotype))
        {
            throw new InvalidOperationException($"The dictionary has no pulse text for chronotype \"{pulse.Chronotype}\".");
        }

        var where = $"chronotype \"{pulse.Chronotype}\" ({context.Tone})";
        // Seeded from the first commit's sha, so the summary is stable for a given history and
        // differs between projects that happen to share a chronotype.
        var seed = commits.Count > 0 ? commits[0].Source.Sha : new string('0', 40);

        var headline = Templating.SelectAndFill(
            chronotype.Narratives.For(context.Tone),
            seed,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["busiestHour"] = pulse.BusiestHour.ToString("D2", CultureInfo.InvariantCulture),
                ["busiestWeekday"] = pulse.BusiestWeekday < dictionary.Locale.Weekdays.Count
                    ? dictionary.Locale.Weekdays[pulse.BusiestWeekday]
                    : "",
                ["commits"] = commits.Count.ToString(CultureInfo.InvariantCulture),
            },
            context.Rules,
            where).Text;

        var percent = (int)Math.Round(pulse.CreationRatio * 100, MidpointRounding.AwayFromZero);
        var creation = percent >= 65
            ? dictionary.Pulse.Creation.Building
            : percent <= 40
                ? dictionary.Pulse.Creation.Refining
                : dictionary.Pulse.Creation.Balanced;

        var streak = pulse.LongestStreak.Days > 0
            ? dictionary.Pulse.Streak.Longest
                .Replace("{streakDays}", pulse.LongestStreak.Days.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
                .Replace("{from}", pulse.LongestStreak.From ?? "", StringComparison.Ordinal)
                .Replace("{to}", pulse.LongestStreak.To ?? "", StringComparison.Ordinal)
            : dictionary.Pulse.Streak.None;

        return string.Join(
            ' ',
            headline,
            creation.Replace("{creationPercent}", percent.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal),
            streak);
    }

    private static string ChronotypeLabel(string chronotype, NarrativeDictionary dictionary)
        => dictionary.Pulse.Chronotypes.TryGetValue(chronotype, out var found)
            ? found.Label
            : throw new InvalidOperationException($"The dictionary has no label for chronotype \"{chronotype}\".");

    /// <summary>
    /// The peak of a circularly smoothed histogram.
    /// </summary>
    /// <remarks>
    /// A raw peak is noise on a small history: fourteen commits at fourteen different hours all
    /// tie at one, the lowest index wins, and the report announces "busiest hour 02" for a
    /// project that only ever commits in daylight. The window is circular, so 23:00 and 01:00
    /// count as neighbours — which is exactly when it matters.
    /// </remarks>
    private static int SmoothedPeakIndex(int[] histogram, int window)
    {
        if (window <= 0) return PeakIndex(histogram);

        var smoothed = new int[histogram.Length];
        for (var hour = 0; hour < histogram.Length; hour += 1)
        {
            var total = 0;
            for (var offset = -window; offset <= window; offset += 1)
            {
                total += histogram[(((hour + offset) % histogram.Length) + histogram.Length) % histogram.Length];
            }
            smoothed[hour] = total;
        }

        var peak = 0;
        for (var hour = 1; hour < smoothed.Length; hour += 1)
        {
            var better = smoothed[hour] > smoothed[peak]
                || (smoothed[hour] == smoothed[peak] && histogram[hour] > histogram[peak]);
            if (better) peak = hour;
        }

        return peak;
    }

    /// <summary>First index holding the maximum, so ties resolve to the earliest slot.</summary>
    private static int PeakIndex(int[] histogram)
    {
        var peak = 0;
        for (var index = 1; index < histogram.Length; index += 1)
        {
            if (histogram[index] > histogram[peak]) peak = index;
        }
        return peak;
    }

    private static double Median(List<int> values)
    {
        if (values.Count == 0) return 0;

        var sorted = values.OrderBy(value => value).ToList();
        var middle = sorted.Count / 2;

        return sorted.Count % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2.0;
    }

    private static double Round(double value, int decimals)
    {
        var factor = Math.Pow(10, decimals);
        return Math.Round(value * factor, MidpointRounding.AwayFromZero) / factor;
    }
}
