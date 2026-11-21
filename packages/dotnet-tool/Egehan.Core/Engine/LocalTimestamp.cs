using System.Globalization;
using System.Text.RegularExpressions;

namespace Egehan.Core.Engine;

/// <summary>
/// Timestamp handling for the story engine.
/// </summary>
/// <remarks>
/// The single most important rule here: a commit's wall-clock time is the one recorded in the
/// commit, and it is never converted. <c>git log %aI</c> yields the author's local time together
/// with its UTC offset, and that offset is what makes "midnight oil" mean midnight where the
/// developer actually was. Using the host's timezone would make the output depend on who ran the
/// tool; converting to UTC would turn a 03:18 commit in Istanbul into a 00:18 one.
///
/// So the fields are parsed straight out of the string, and <see cref="DateTimeOffset"/> is used
/// only for instant arithmetic — never to extract an hour or a weekday.
/// </remarks>
public sealed record LocalTimestamp(
    string Iso,
    long EpochMs,
    int OffsetMinutes,
    int Year,
    int Month,
    int Day,
    int Hour,
    int Minute,
    int Second,
    int Weekday,
    string DayKey,
    string MonthKey);

public static class Timestamps
{
    private static readonly Regex IsoPattern = new(
        @"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$",
        RegexOptions.CultureInvariant);

    private const long MillisecondsPerDay = 86_400_000L;

    public static LocalTimestamp Parse(string iso)
    {
        var match = IsoPattern.Match(iso);
        if (!match.Success)
        {
            throw new FormatException($"Not an ISO-8601 timestamp with an offset: \"{iso}\"");
        }

        var year = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);

        var instant = DateTimeOffset.Parse(iso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

        // Day-of-week from the *local* calendar date, so the host timezone cannot influence it.
        var weekday = ((int)new DateTime(year, month, day, 0, 0, 0, DateTimeKind.Utc).DayOfWeek + 6) % 7;

        return new LocalTimestamp(
            Iso: iso,
            EpochMs: instant.ToUnixTimeMilliseconds(),
            OffsetMinutes: ParseOffset(match.Groups[7].Value),
            Year: year,
            Month: month,
            Day: day,
            Hour: int.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture),
            Minute: int.Parse(match.Groups[5].Value, CultureInfo.InvariantCulture),
            Second: int.Parse(match.Groups[6].Value, CultureInfo.InvariantCulture),
            Weekday: weekday,
            DayKey: $"{match.Groups[1].Value}-{match.Groups[2].Value}-{match.Groups[3].Value}",
            MonthKey: $"{match.Groups[1].Value}-{match.Groups[2].Value}");
    }

    private static int ParseOffset(string offset)
    {
        if (offset == "Z") return 0;

        var sign = offset[0] == '-' ? -1 : 1;
        var hours = int.Parse(offset.AsSpan(1, 2), CultureInfo.InvariantCulture);
        var minutes = int.Parse(offset.AsSpan(4, 2), CultureInfo.InvariantCulture);
        return sign * ((hours * 60) + minutes);
    }

    /// <summary>Calendar days from <paramref name="from"/> to <paramref name="to"/>, inclusive.</summary>
    public static int InclusiveDaySpan(LocalTimestamp from, LocalTimestamp to)
        => (int)(DayNumber(to) - DayNumber(from)) + 1;

    public static int DayKeyDistance(string earlier, string later)
        => (int)(DayKeyToNumber(later) - DayKeyToNumber(earlier));

    public static double HoursBetween(LocalTimestamp earlier, LocalTimestamp later)
        => (later.EpochMs - earlier.EpochMs) / 3_600_000.0;

    private static long DayNumber(LocalTimestamp timestamp)
        => ToEpochDay(timestamp.Year, timestamp.Month, timestamp.Day);

    private static long DayKeyToNumber(string dayKey)
    {
        var parts = dayKey.Split('-');
        return ToEpochDay(
            int.Parse(parts[0], CultureInfo.InvariantCulture),
            int.Parse(parts[1], CultureInfo.InvariantCulture),
            int.Parse(parts[2], CultureInfo.InvariantCulture));
    }

    private static long ToEpochDay(int year, int month, int day)
        => new DateTime(year, month, day, 0, 0, 0, DateTimeKind.Utc).Ticks / TimeSpan.TicksPerMillisecond / MillisecondsPerDay;

    /// <summary>`03:18` — zero-padded, locale-independent.</summary>
    public static string FormatClock(LocalTimestamp timestamp, string template)
        => template
            .Replace("{hour}", timestamp.Hour.ToString("D2", CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{minute}", timestamp.Minute.ToString("D2", CultureInfo.InvariantCulture), StringComparison.Ordinal);

    /// <summary>`14 Mart 2026` — month names come from the dictionary, never from the OS culture.</summary>
    public static string FormatDate(LocalTimestamp timestamp, string template, IReadOnlyList<string> monthNames)
    {
        if (timestamp.Month - 1 >= monthNames.Count)
        {
            throw new InvalidOperationException($"The dictionary provides no name for month {timestamp.Month}.");
        }

        return template
            .Replace("{day}", timestamp.Day.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{month}", monthNames[timestamp.Month - 1], StringComparison.Ordinal)
            .Replace("{year}", timestamp.Year.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }

    /// <summary>"Now", with the host's offset preserved rather than normalised to Z.</summary>
    public static string NowIso(DateTimeOffset? now = null)
        => (now ?? DateTimeOffset.Now).ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);
}
