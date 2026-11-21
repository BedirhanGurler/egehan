using System.Globalization;
using System.Text.RegularExpressions;
using Egehan.Core.Engine;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Render;

/// <summary>
/// Renders <c>EGEHAN.md</c> — the version of the chronicle that lives in the repository.
/// </summary>
/// <remarks>
/// This output is held to a stricter standard than the report: it must be **byte-identical** to
/// what the Node engine writes. The file is committed, and a team with a mixed toolchain would
/// otherwise watch it flip back and forth in the diff depending on who ran the tool last.
///
/// That standard is why the transcription is literal down to details that look like accidents:
/// the minus sign is U+2212, the separator is U+00B7, and the heading's double-space collapse
/// replaces one occurrence because JavaScript's <c>String.replace</c> with a string argument does.
/// </remarks>
public static class MarkdownRenderer
{
    private static readonly string[] Spark = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

    public static string Render(EgehanReport report, NarrativeDictionary dictionary, EgehanRules rules)
    {
        var lines = new List<string>();

        lines.Add($"# {Fill(dictionary.UiString("documentTitle"), new() { ["project"] = report.Project.Name })}");
        lines.Add("");

        if (!string.IsNullOrWhiteSpace(report.Project.Dedication))
        {
            lines.Add($"> {report.Project.Dedication.Trim()}");
            lines.Add("");
        }

        lines.Add("> " + Fill(dictionary.UiString("subtitle"), new()
        {
            ["days"] = report.Range.Days.ToString(CultureInfo.InvariantCulture),
            ["commits"] = report.Totals.Commits.ToString(CultureInfo.InvariantCulture),
        }));
        lines.Add("");

        lines.AddRange(RenderSummary(report, dictionary));
        lines.Add("");
        lines.AddRange(RenderPulse(report, dictionary));
        lines.Add("");

        if (report.Milestones.Count > 0)
        {
            lines.AddRange(RenderMilestones(report, dictionary));
            lines.Add("");
        }

        lines.Add($"## {Or(dictionary.UiString("timelineTitle"), "Timeline")}");
        lines.Add("");

        for (var index = 0; index < report.Chapters.Count; index += 1)
        {
            lines.AddRange(RenderChapter(report.Chapters[index], index, report, dictionary));
            lines.Add("");
        }

        lines.Add("---");
        lines.Add("");

        // No generation timestamp unless the contract asks for one: this file is committed, and a
        // hook that regenerates it after every commit must leave the bytes alone when the history
        // has not changed.
        var footer = new List<string>
        {
            Fill(dictionary.UiString("generatedBy"), new() { ["version"] = report.Generator.Version }),
        };
        if (rules.Output.EmbedGenerationTimeInArtifacts)
        {
            footer.Add(Fill(dictionary.UiString("generatedAt"), new() { ["date"] = report.Generator.GeneratedAt }));
        }
        lines.Add($"<sub>{string.Join(" · ", footer)}</sub>");

        var body = Regex.Replace(string.Join('\n', lines), @"\n{3,}", "\n\n").TrimEnd();
        return body + "\n";
    }

    private static List<string> RenderSummary(EgehanReport report, NarrativeDictionary dictionary)
    {
        var rows = new List<(string Label, string Value)>
        {
            (Or(dictionary.Label("totalCommits"), "Commits"), report.Totals.Commits.ToString(CultureInfo.InvariantCulture)),
            (Or(dictionary.Label("totalAuthors"), "Authors"), report.Totals.Authors.ToString(CultureInfo.InvariantCulture)),
            (Or(dictionary.Label("projectAge"), "Age"),
                $"{report.Range.Days.ToString(CultureInfo.InvariantCulture)} {Or(dictionary.UiString("daysLabel"), "days")}"),
            (Or(dictionary.Label("filesTouched"), Or(dictionary.UiString("filesLabel"), "files")),
                report.Totals.FilesTouched.ToString(CultureInfo.InvariantCulture)),
            (Or(dictionary.Label("lineChurn"),
                    $"{Or(dictionary.UiString("insertionsLabel"), "+")} / {Or(dictionary.UiString("deletionsLabel"), "-")}"),
                $"+{report.Totals.Insertions.ToString(CultureInfo.InvariantCulture)} / −{report.Totals.Deletions.ToString(CultureInfo.InvariantCulture)}"),
        };

        var categories = report.Totals.ByCategory
            .Where(entry => entry.Value > 0)
            .Select(entry =>
            {
                dictionary.Categories.TryGetValue(entry.Key, out var narratives);
                return $"{narratives?.Icon ?? ""} {narratives?.Label ?? entry.Key} {entry.Value.ToString(CultureInfo.InvariantCulture)}".Trim();
            });

        var lines = new List<string> { "| | |", "| --- | --- |" };
        lines.AddRange(rows.Select(row => $"| {row.Label} | **{row.Value}** |"));
        lines.Add("");
        lines.Add(string.Join(" · ", categories));

        return lines;
    }

    private static List<string> RenderPulse(EgehanReport report, NarrativeDictionary dictionary)
    {
        var pulse = report.Pulse;
        dictionary.Pulse.Chronotypes.TryGetValue(pulse.Chronotype, out var chronotype);

        var weekday = pulse.BusiestWeekday < dictionary.Locale.Weekdays.Count
            ? dictionary.Locale.Weekdays[pulse.BusiestWeekday]
            : "";

        return
        [
            $"## {dictionary.Pulse.Title}",
            "",
            pulse.Narrative,
            "",
            "| | |",
            "| --- | --- |",
            $"| {dictionary.Label("chronotype")} | **{chronotype?.Icon ?? ""} {pulse.ChronotypeLabel}** |",
            $"| {dictionary.Label("busiestDay")} | **{weekday}** |",
            $"| {dictionary.Label("busiestHour")} | **{pulse.BusiestHour.ToString("D2", CultureInfo.InvariantCulture)}:00** |",
            $"| {dictionary.Label("creationRatio")} | **%{Math.Round(pulse.CreationRatio * 100, MidpointRounding.AwayFromZero).ToString("0", CultureInfo.InvariantCulture)}** |",
            $"| {dictionary.Label("avgCommitSize")} | **{Number(pulse.AvgChangedLines)} {dictionary.Units.Line.Other}** |",
            $"| {dictionary.Label("longestStreak")} | **{pulse.LongestStreak.Days.ToString(CultureInfo.InvariantCulture)} {dictionary.Units.Day.Other}** |",
            "",
            $"**{dictionary.Label("hourDistribution")}**",
            "",
            "```text",
            Sparkline(pulse.HourHistogram),
            "0   3   6   9   12  15  18  21",
            "```",
        ];
    }

    private static List<string> RenderMilestones(EgehanReport report, NarrativeDictionary dictionary)
    {
        dictionary.Categories.TryGetValue("milestone", out var milestone);
        var lines = new List<string> { $"## {milestone?.Icon ?? ""} {milestone?.Label ?? ""}", "" };

        foreach (var entry in report.Milestones)
        {
            var at = Timestamps.Parse(entry.At);
            var date = Timestamps.FormatDate(at, dictionary.Locale.DateFormat, dictionary.Locale.Months);
            lines.Add($"- **{date}** — {entry.Narrative}");
        }

        return lines;
    }

    private static List<string> RenderChapter(
        ReportChapter chapter,
        int index,
        EgehanReport report,
        NarrativeDictionary dictionary)
    {
        dictionary.Categories.TryGetValue(chapter.Category, out var narratives);

        var bySha = report.Entries.ToDictionary(entry => entry.Sha, StringComparer.Ordinal);
        var entries = chapter.EntryShas
            .Where(bySha.ContainsKey)
            .Select(sha => bySha[sha])
            .ToList();

        var from = Timestamps.Parse(chapter.From);
        var to = Timestamps.Parse(chapter.To);

        var range = from.DayKey == to.DayKey
            ? Timestamps.FormatDate(from, dictionary.Locale.DateFormat, dictionary.Locale.Months)
            : Timestamps.FormatDate(from, dictionary.Locale.DateShortFormat, dictionary.Locale.Months)
                + " – " + Timestamps.FormatDate(to, dictionary.Locale.DateFormat, dictionary.Locale.Months);

        var heading = ReplaceFirst(
            $"### {(index + 1).ToString(CultureInfo.InvariantCulture)}. {narratives?.Icon ?? ""} {chapter.Title}",
            "  ",
            " ");

        var lines = new List<string>
        {
            heading,
            "",
            $"<sub>{range} · {Fill(dictionary.UiString("chapterCommits"), new() { ["commits"] = chapter.Stats.Commits.ToString(CultureInfo.InvariantCulture) })}</sub>",
            "",
            $"*{chapter.Narrative}*",
            "",
        };

        var byId = report.Authors.ToDictionary(author => author.Id, StringComparer.Ordinal);

        foreach (var entry in entries)
        {
            var at = Timestamps.Parse(entry.AuthoredAt);
            var date = Timestamps.FormatDate(at, dictionary.Locale.DateShortFormat, dictionary.Locale.Months);
            byId.TryGetValue(entry.AuthorId, out var author);

            lines.Add($"- **{date}** · `{entry.ShortSha}` — {entry.Narrative}");
            lines.Add(
                $"  <sub>{author?.DisplayName ?? ""} · "
                + $"{entry.Stats.FilesCount.ToString(CultureInfo.InvariantCulture)} {dictionary.UiString("filesLabel")} · "
                + $"+{entry.Stats.Insertions.ToString(CultureInfo.InvariantCulture)} / −{entry.Stats.Deletions.ToString(CultureInfo.InvariantCulture)}"
                + (entry.Tags.Count > 0 ? $" · `{string.Join("`, `", entry.Tags)}`" : "")
                + "</sub>");
        }

        return lines;
    }

    /// <summary>A 24-column bar chart, scaled to the busiest hour.</summary>
    private static string Sparkline(IReadOnlyList<int> histogram)
    {
        var peak = Math.Max(1, histogram.Count == 0 ? 1 : histogram.Max());

        return string.Concat(histogram.Select(count =>
        {
            if (count == 0) return " ";
            var level = (int)Math.Ceiling(count / (double)peak * Spark.Length) - 1;
            return Spark[Math.Max(0, Math.Min(Spark.Length - 1, level))];
        }));
    }

    /// <summary>
    /// JavaScript's <c>String.replace</c> with a string pattern changes the first match only;
    /// .NET's changes every one. The heading collapse relies on the former.
    /// </summary>
    private static string ReplaceFirst(string text, string search, string replacement)
    {
        var at = text.IndexOf(search, StringComparison.Ordinal);
        return at < 0 ? text : text[..at] + replacement + text[(at + search.Length)..];
    }

    /// <summary>Shortest round-trippable form, which is what JavaScript prints for a number.</summary>
    private static string Number(double value) => value.ToString("R", CultureInfo.InvariantCulture);

    private static string Or(string value, string fallback) => value.Length > 0 ? value : fallback;

    private static string Fill(string template, Dictionary<string, string> values)
        => Regex.Replace(template, @"\{([A-Za-z][A-Za-z0-9]*)\}", match =>
            values.TryGetValue(match.Groups[1].Value, out var value) ? value : match.Value);
}
