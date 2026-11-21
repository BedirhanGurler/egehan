using System.Globalization;
using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// Turns facts into sentences.
/// </summary>
/// <remarks>
/// The narrator owns exactly one responsibility: assembling the values a template needs and
/// asking <see cref="Templating"/> for the sentence. No classification logic, no statistics — if
/// a number has to be computed, it was computed before this ran. That separation is what makes
/// the narration portable: a port has to reproduce this value table, not this code.
/// </remarks>
public sealed record NarrationContext(
    NarrativeDictionary Dictionary,
    EgehanRules Rules,
    string Tone,
    string Language,
    string Flavor);

public sealed record NarratedEntry(string Narrative, int VariantIndex);

public sealed record NarratedChapter(string Title, string Narrative);

public sealed record ChapterFacts(
    string Category,
    int Commits,
    int Insertions,
    int Deletions,
    int FilesCount,
    int AuthorsCount,
    LocalTimestamp From,
    LocalTimestamp To,
    string SeedSha);

public static class Narrator
{
    public static NarratedEntry NarrateEntry(
        PreparedCommit commit,
        string category,
        IReadOnlyList<string> secondaryCategories,
        string authorName,
        NarrationContext context)
    {
        var narratives = context.Dictionary.RequireCategory(category);
        var values = EntryPlaceholders(commit, authorName, context);
        var where = $"category \"{category}\" entry ({context.Tone})";

        var selection = Templating.SelectAndFill(
            narratives.Entries.For(context.Tone),
            commit.Source.Sha,
            values,
            context.Rules,
            where);

        var modifier = ModifierClause(commit, secondaryCategories, values, context);
        var sentence = modifier is null ? selection.Text : $"{selection.Text} {modifier}";

        return new NarratedEntry(
            Templating.CapitalizeSentence(sentence, context.Rules, context.Language),
            selection.Index);
    }

    /// <summary>
    /// One extra clause for a secondary category.
    /// </summary>
    /// <remarks>
    /// Capped at <c>maxModifiersPerEntry</c>, which is 1. A sentence carrying three appended
    /// clauses reads like generated text, and the point of the dictionary is that it does not.
    /// </remarks>
    private static string? ModifierClause(
        PreparedCommit commit,
        IReadOnlyList<string> secondaryCategories,
        IReadOnlyDictionary<string, string> values,
        NarrationContext context)
    {
        if (context.Rules.Classification.MaxModifiersPerEntry < 1 || secondaryCategories.Count == 0) return null;

        var category = secondaryCategories[0];
        if (!context.Dictionary.Modifiers.TryGetValue(category, out var variants)) return null;

        var where = $"modifier \"{category}\" ({context.Tone})";

        // A different hash source from the main sentence, so a commit does not always pair
        // variant 2 with variant 2 — otherwise the two lists would act as one shorter list.
        return Templating.SelectAndFill(
            variants.For(context.Tone),
            ReverseSha(commit.Source.Sha),
            values,
            context.Rules,
            where).Text;
    }

    private static string FirstOrEmpty(IReadOnlyList<string> preferred, IReadOnlyList<string> fallback)
        => preferred.Count > 0 ? preferred[0] : (fallback.Count > 0 ? fallback[0] : "");

    private static string ReverseSha(string sha)
    {
        var characters = sha.ToCharArray();
        Array.Reverse(characters);
        return new string(characters);
    }

    public static IReadOnlyDictionary<string, string> EntryPlaceholders(
        PreparedCommit commit,
        string authorName,
        NarrationContext context)
    {
        var dictionary = context.Dictionary;
        var flavor = FlavorVocabulary(context);
        var at = commit.AuthoredAt;

        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["author"] = authorName,
            ["date"] = Timestamps.FormatDate(at, dictionary.Locale.DateFormat, dictionary.Locale.Months),
            ["dateShort"] = Timestamps.FormatDate(at, dictionary.Locale.DateShortFormat, dictionary.Locale.Months),
            ["time"] = Timestamps.FormatClock(at, dictionary.Locale.TimeFormat),
            ["weekday"] = WeekdayName(at, dictionary),
            ["month"] = MonthName(at, dictionary),
            ["year"] = at.Year.ToString(CultureInfo.InvariantCulture),
            ["files"] = FormatUnit(commit.FilesCount, dictionary.Units.File, dictionary),
            ["filesCount"] = commit.FilesCount.ToString(CultureInfo.InvariantCulture),
            ["additions"] = FormatUnit(commit.Insertions, dictionary.Units.Line, dictionary),
            ["removals"] = FormatUnit(commit.Deletions, dictionary.Units.Line, dictionary),
            ["insertions"] = commit.Insertions.ToString(CultureInfo.InvariantCulture),
            ["deletions"] = commit.Deletions.ToString(CultureInfo.InvariantCulture),
            ["changedLines"] = commit.ChangedLines.ToString(CultureInfo.InvariantCulture),
            ["subject"] = commit.CleanSubject,
            ["scope"] = commit.Conventional.Scope ?? "",
            ["tag"] = FirstOrEmpty(commit.ReleaseTags, commit.Tags),
            ["flavorSubject"] = flavor.Subject,
            ["flavorArtifact"] = flavor.Artifact,
            ["flavorLayer"] = flavor.Layer,
            ["flavorDomain"] = flavor.Domain,
        };
    }

    public static NarratedChapter NarrateChapter(ChapterFacts facts, NarrationContext context)
    {
        var narratives = context.Dictionary.RequireCategory(facts.Category);
        var values = ChapterPlaceholders(facts, context);

        var titleWhere = $"category \"{facts.Category}\" chapter title ({context.Tone})";
        var bodyWhere = $"category \"{facts.Category}\" chapter narrative ({context.Tone})";

        var title = Templating.SelectAndFill(
            narratives.ChapterTitles.For(context.Tone), facts.SeedSha, values, context.Rules, titleWhere);
        var body = Templating.SelectAndFill(
            narratives.ChapterNarratives.For(context.Tone), ReverseSha(facts.SeedSha), values, context.Rules, bodyWhere);

        return new NarratedChapter(
            title.Text,
            Templating.CapitalizeSentence(body.Text, context.Rules, context.Language));
    }

    private static Dictionary<string, string> ChapterPlaceholders(
        ChapterFacts facts,
        NarrationContext context)
    {
        var dictionary = context.Dictionary;
        var flavor = FlavorVocabulary(context);

        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["commits"] = FormatUnit(facts.Commits, dictionary.Units.Commit, dictionary),
            ["commitsCount"] = facts.Commits.ToString(CultureInfo.InvariantCulture),
            ["span"] = FormatUnit(
                Timestamps.InclusiveDaySpan(facts.From, facts.To), dictionary.Units.Day, dictionary),
            ["from"] = Timestamps.FormatDate(facts.From, dictionary.Locale.DateShortFormat, dictionary.Locale.Months),
            ["to"] = Timestamps.FormatDate(facts.To, dictionary.Locale.DateShortFormat, dictionary.Locale.Months),
            ["range"] = FormatRange(facts.From, facts.To, dictionary, "range"),
            ["period"] = FormatRange(facts.From, facts.To, dictionary, "period"),
            ["authorsCount"] = facts.AuthorsCount.ToString(CultureInfo.InvariantCulture),
            ["files"] = FormatUnit(facts.FilesCount, dictionary.Units.File, dictionary),
            ["filesCount"] = facts.FilesCount.ToString(CultureInfo.InvariantCulture),
            ["additions"] = FormatUnit(facts.Insertions, dictionary.Units.Line, dictionary),
            ["removals"] = FormatUnit(facts.Deletions, dictionary.Units.Line, dictionary),
            ["insertions"] = facts.Insertions.ToString(CultureInfo.InvariantCulture),
            ["deletions"] = facts.Deletions.ToString(CultureInfo.InvariantCulture),
            ["changedLines"] = (facts.Insertions + facts.Deletions).ToString(CultureInfo.InvariantCulture),
            ["flavorSubject"] = flavor.Subject,
            ["flavorArtifact"] = flavor.Artifact,
            ["flavorLayer"] = flavor.Layer,
            ["flavorDomain"] = flavor.Domain,
        };
    }

    /// <summary>
    /// A chapter's span, in one of the two shapes the dictionary provides.
    /// </summary>
    /// <remarks>
    /// <c>range</c> is the bare span, for label positions; <c>period</c> is the same span as a
    /// natural temporal phrase, for prose. One shape cannot serve both: a single-day chapter with
    /// the connective baked into the template reads "30 Mayıs arasında", which is ungrammatical,
    /// and English needs its preposition to change with the shape.
    /// </remarks>
    public static string FormatRange(
        LocalTimestamp from,
        LocalTimestamp to,
        NarrativeDictionary dictionary,
        string shape)
    {
        var sameDay = from.DayKey == to.DayKey;
        var template = shape == "range"
            ? (sameDay ? dictionary.Locale.RangeSameDayFormat : dictionary.Locale.RangeFormat)
            : (sameDay ? dictionary.Locale.PeriodSameDayFormat : dictionary.Locale.PeriodFormat);

        return template
            .Replace(
                "{from}",
                Timestamps.FormatDate(from, dictionary.Locale.DateShortFormat, dictionary.Locale.Months),
                StringComparison.Ordinal)
            .Replace(
                "{to}",
                Timestamps.FormatDate(to, dictionary.Locale.DateShortFormat, dictionary.Locale.Months),
                StringComparison.Ordinal);
    }

    public static FlavorVocabulary FlavorVocabulary(NarrationContext context)
        => context.Dictionary.Flavors.TryGetValue(context.Flavor, out var vocabulary)
            ? vocabulary
            : throw new InvalidOperationException(
                $"The dictionary has no vocabulary for project flavor \"{context.Flavor}\".");

    /// <summary>`4 dosya` / `4 files` — pluralisation is the dictionary's business.</summary>
    public static string FormatUnit(int count, PluralForms forms, NarrativeDictionary dictionary)
        => dictionary.Units.Format
            .Replace("{n}", count.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{unit}", count == 1 ? forms.One : forms.Other, StringComparison.Ordinal);

    private static string WeekdayName(LocalTimestamp at, NarrativeDictionary dictionary)
        => at.Weekday < dictionary.Locale.Weekdays.Count
            ? dictionary.Locale.Weekdays[at.Weekday]
            : throw new InvalidOperationException($"The dictionary provides no name for weekday index {at.Weekday}.");

    private static string MonthName(LocalTimestamp at, NarrativeDictionary dictionary)
        => at.Month - 1 < dictionary.Locale.Months.Count
            ? dictionary.Locale.Months[at.Month - 1]
            : throw new InvalidOperationException($"The dictionary provides no name for month {at.Month}.");
}
