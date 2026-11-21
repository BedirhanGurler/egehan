using System.Globalization;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Cli;

/// <summary>
/// <c>egehan stats</c> — the Developer Pulse, in the terminal.
/// </summary>
/// <remarks>
/// Read-only by design: it is the command somebody runs out of curiosity, and a command run out
/// of curiosity must never leave anything behind.
/// </remarks>
internal static class Dashboard
{
    private static readonly string[] Blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    private const int PanelWidth = 64;

    public static void Render(EgehanReport report, NarrativeDictionary dictionary)
    {
        var pulse = report.Pulse;
        dictionary.Pulse.Chronotypes.TryGetValue(pulse.Chronotype, out var chronotype);

        Output.Info();
        Output.Info(Output.Muted($"╭{new string('─', PanelWidth - 2)}╮"));
        Output.Info(Line($"{Output.Heading(report.Project.Name)} {Output.Muted("— " + dictionary.Pulse.Title)}"));
        Output.Info(Separator());

        foreach (var line in Wrap(pulse.Narrative, PanelWidth - 4)) Output.Info(Line(line));
        Output.Info(Separator());

        var weekday = pulse.BusiestWeekday < dictionary.Locale.Weekdays.Count
            ? dictionary.Locale.Weekdays[pulse.BusiestWeekday]
            : "";

        var rows = new List<(string Label, string Value)>
        {
            (dictionary.Label("chronotype"), $"{chronotype?.Icon ?? ""} {pulse.ChronotypeLabel}"),
            (dictionary.Label("busiestDay"), weekday),
            (dictionary.Label("busiestHour"), $"{pulse.BusiestHour.ToString("D2", CultureInfo.InvariantCulture)}:00"),
            (dictionary.Label("creationRatio"), $"{Math.Round(pulse.CreationRatio * 100, MidpointRounding.AwayFromZero).ToString("0", CultureInfo.InvariantCulture)}%"),
            (dictionary.Label("avgCommitSize"), $"{pulse.AvgChangedLines.ToString("R", CultureInfo.InvariantCulture)} {dictionary.Units.Line.Other}"),
            (dictionary.Label("longestStreak"), pulse.LongestStreak.Days > 0
                ? $"{pulse.LongestStreak.Days.ToString(CultureInfo.InvariantCulture)} ({pulse.LongestStreak.From} → {pulse.LongestStreak.To})"
                : "—"),
            (dictionary.Label("totalCommits"), report.Totals.Commits.ToString(CultureInfo.InvariantCulture)),
            (dictionary.Label("totalAuthors"), report.Totals.Authors.ToString(CultureInfo.InvariantCulture)),
            (dictionary.Label("projectAge"), $"{report.Range.Days.ToString(CultureInfo.InvariantCulture)} {dictionary.UiString("daysLabel")}"),
        };

        var widest = rows.Max(row => Output.VisibleWidth(row.Label));
        foreach (var row in rows)
        {
            var padding = new string(' ', Math.Max(0, widest - Output.VisibleWidth(row.Label)));
            Output.Info(Line($"{Output.Muted(row.Label + padding)}  {Output.Value(row.Value)}"));
        }

        Output.Info(Separator());
        Output.Info(Line(Output.Muted(dictionary.Label("hourDistribution"))));
        Output.Info(Line(Histogram(pulse.HourHistogram, 1)));
        Output.Info(Line(Output.Muted("0   3   6   9   12  15  18  21")));

        Output.Info(Separator());
        Output.Info(Line(Output.Muted(dictionary.Label("weekdayDistribution"))));
        Output.Info(Line(Histogram(pulse.WeekdayHistogram, 3)));
        Output.Info(Line(Output.Muted(string.Concat(
            dictionary.Locale.WeekdaysShort.Select(day => (day.Length > 3 ? day[..3] : day).PadRight(3))))));

        Output.Info(Separator());
        var categories = report.Totals.ByCategory
            .Where(entry => entry.Value > 0)
            .Select(entry =>
            {
                dictionary.Categories.TryGetValue(entry.Key, out var narratives);
                return $"{narratives?.Icon ?? ""}{Output.Value(entry.Value.ToString(CultureInfo.InvariantCulture))}";
            });
        Output.Info(Line(string.Join("  ", categories)));
        Output.Info(Output.Muted($"╰{new string('─', PanelWidth - 2)}╯"));
        Output.Info();
    }

    private static string Histogram(IReadOnlyList<int> values, int cellWidth)
    {
        var peak = Math.Max(1, values.Count == 0 ? 1 : values.Max());

        return string.Concat(values.Select(count =>
        {
            if (count == 0) return new string(' ', cellWidth);
            var level = (int)Math.Ceiling(count / (double)peak * Blocks.Length) - 1;
            return Output.Accent(Blocks[Math.Max(0, Math.Min(Blocks.Length - 1, level))].PadRight(cellWidth));
        }));
    }

    /// <summary>Word wrap that counts visible columns, so styled text does not break the frame.</summary>
    private static List<string> Wrap(string text, int width)
    {
        var lines = new List<string>();
        var line = "";

        foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (line.Length == 0) line = word;
            else if (Output.VisibleWidth($"{line} {word}") <= width) line = $"{line} {word}";
            else
            {
                lines.Add(line);
                line = word;
            }
        }

        if (line.Length > 0) lines.Add(line);
        return lines.Count > 0 ? lines : [""];
    }

    private static string Separator() => Output.Muted($"├{new string('─', PanelWidth - 2)}┤");

    private static string Line(string content)
    {
        var padding = Math.Max(0, PanelWidth - 4 - Output.VisibleWidth(content));
        return $"{Output.Muted("│")} {content}{new string(' ', padding)} {Output.Muted("│")}";
    }
}
