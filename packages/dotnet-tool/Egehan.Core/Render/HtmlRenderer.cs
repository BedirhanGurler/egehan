using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Render;

/// <summary>
/// Renders <c>egehan-chronicle.html</c>.
/// </summary>
/// <remarks>
/// Almost nothing happens here: the report and the language strings are injected into
/// <c>core-spec/templates/egehan-book.html</c>, which draws the page itself. That split is the
/// point — presentation lives in one file both engines share, so they produce the same chronicle
/// instead of each assembling markup that would drift apart (docs/ARCHITECTURE.md, ADR-011).
/// </remarks>
public static class HtmlRenderer
{
    // Built at runtime rather than written as "\u2028": C# treats those two code points as
    // line terminators while lexing, so the escape would end the string literal.
    private static readonly string LineSeparator = char.ConvertFromUtf32(0x2028);
    private static readonly string ParagraphSeparator = char.ConvertFromUtf32(0x2029);

    private const string LangMarker = "__EGEHAN_LANG__";
    private const string ThemeMarker = "__EGEHAN_THEME__";
    private const string TitleMarker = "__EGEHAN_TITLE__";
    private const string ReportMarker = "__EGEHAN_REPORT__";
    private const string StringsMarker = "__EGEHAN_STRINGS__";

    /// <summary>
    /// Compact, non-ASCII left alone, nulls kept.
    /// </summary>
    /// <remarks>
    /// Chosen to match <c>JSON.stringify</c> exactly, because the two engines' HTML is compared
    /// byte for byte: the relaxed encoder stops Turkish characters becoming <c>ğ</c>, and
    /// keeping nulls stops a field quietly disappearing from one engine's output.
    /// </remarks>
    private static readonly JsonSerializerOptions EmbedOptions = new()
    {
        // camelCase for the records that carry no explicit name — the dictionary types reuse the
        // shapes the loader reads, and those came from camelCase JSON. An explicit
        // [JsonPropertyName] still wins, which is what keeps the report's field names exact.
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static string Render(EgehanReport report, NarrativeDictionary dictionary, EgehanRules rules)
    {
        var template = EmbeddedAssets.ReadTemplate();

        var title = Fill(
            dictionary.UiString("documentTitle").Length > 0 ? dictionary.UiString("documentTitle") : "{project}",
            report.Project.Name);

        var html = template;
        html = ReplaceOnce(html, LangMarker, EscapeAttribute(report.Config.Language));
        html = ReplaceOnce(html, ThemeMarker, EscapeAttribute(report.Config.Theme));
        html = ReplaceOnce(html, TitleMarker, EscapeText(title));
        html = ReplaceOnce(html, ReportMarker, EmbedJson(ReportForPage(report, rules)));
        html = ReplaceOnce(html, StringsMarker, EmbedJson(PageStrings(dictionary, rules)));

        return html;
    }

    /// <summary>
    /// The report as the page receives it, with the generation time blanked unless the contract
    /// asks for it — the rendered artifacts are meant to be committed.
    /// </summary>
    private static EgehanReport ReportForPage(EgehanReport report, EgehanRules rules)
        => rules.Output.EmbedGenerationTimeInArtifacts
            ? report
            : report with { Generator = report.Generator with { GeneratedAt = "" } };

    /// <summary>
    /// The subset of the dictionary the page needs.
    /// </summary>
    /// <remarks>
    /// Property order here is the serialisation order, and it mirrors the Node engine's object
    /// literal so the embedded JSON comes out identical.
    /// </remarks>
    private sealed record PageStringsPayload
    {
        [JsonPropertyName("language")] public required string Language { get; init; }
        [JsonPropertyName("locale")] public required LocaleStrings Locale { get; init; }
        [JsonPropertyName("units")] public required UnitStrings Units { get; init; }
        [JsonPropertyName("ui")] public required IReadOnlyDictionary<string, string> Ui { get; init; }
        [JsonPropertyName("categories")] public required IReadOnlyDictionary<string, IconLabel> Categories { get; init; }
        [JsonPropertyName("pulse")] public required PulsePayload Pulse { get; init; }
        [JsonPropertyName("crypto")] public required CryptoPayload Crypto { get; init; }
    }

    private sealed record IconLabel
    {
        [JsonPropertyName("label")] public required string Label { get; init; }
        [JsonPropertyName("icon")] public required string Icon { get; init; }
    }

    private sealed record PulsePayload
    {
        [JsonPropertyName("title")] public required string Title { get; init; }
        [JsonPropertyName("labels")] public required IReadOnlyDictionary<string, string> Labels { get; init; }
        [JsonPropertyName("chronotypes")] public required IReadOnlyDictionary<string, IconLabel> Chronotypes { get; init; }
    }

    private sealed record CryptoPayload
    {
        [JsonPropertyName("additionalDataFormat")] public required string AdditionalDataFormat { get; init; }
    }

    private static PageStringsPayload PageStrings(NarrativeDictionary dictionary, EgehanRules rules) => new()
    {
        Language = dictionary.Language,
        Locale = dictionary.Locale,
        Units = dictionary.Units,
        Ui = WithoutComments(dictionary.Ui),
        Categories = dictionary.Categories.ToDictionary(
            entry => entry.Key,
            entry => new IconLabel { Label = entry.Value.Label, Icon = entry.Value.Icon },
            StringComparer.Ordinal),
        Pulse = new PulsePayload
        {
            Title = dictionary.Pulse.Title,
            Labels = WithoutComments(dictionary.Pulse.Labels),
            Chronotypes = dictionary.Pulse.Chronotypes.ToDictionary(
                entry => entry.Key,
                entry => new IconLabel { Label = entry.Value.Label, Icon = entry.Value.Icon },
                StringComparer.Ordinal),
        },
        Crypto = new CryptoPayload { AdditionalDataFormat = rules.Capsule.AdditionalDataFormat },
    };

    private static Dictionary<string, string> WithoutComments(IReadOnlyDictionary<string, string> source)
        => source
            .Where(entry => !entry.Key.StartsWith('$'))
            .ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal);

    /// <summary>
    /// Serialises JSON for embedding inside a <c>&lt;script type="application/json"&gt;</c> block.
    /// </summary>
    /// <remarks>
    /// <c>&lt;</c> becomes <c><</c>, which is what stops a commit subject containing
    /// <c>&lt;/script&gt;</c> from ending the block and turning the rest of the chronicle into
    /// markup. Commit messages are written by anyone who can push, and this file is opened by the
    /// maintainer.
    /// </remarks>
    private static string EmbedJson(object value)
        => JsonAstral.Unescape(JsonSerializer.Serialize(value, value.GetType(), EmbedOptions))
            .Replace("<", "\\u003c", StringComparison.Ordinal)
            .Replace(">", "\\u003e", StringComparison.Ordinal)
            .Replace("&", "\\u0026", StringComparison.Ordinal)
            .Replace(LineSeparator, "\\u2028", StringComparison.Ordinal)
            .Replace(ParagraphSeparator, "\\u2029", StringComparison.Ordinal);

    private static string EscapeText(string value)
        => value
            .Replace("&", "&amp;", StringComparison.Ordinal)
            .Replace("<", "&lt;", StringComparison.Ordinal)
            .Replace(">", "&gt;", StringComparison.Ordinal);

    private static string EscapeAttribute(string value)
        => EscapeText(value)
            .Replace("\"", "&quot;", StringComparison.Ordinal)
            .Replace("'", "&#39;", StringComparison.Ordinal);

    /// <summary>
    /// Replaces a marker that must appear exactly once, so a template edit that renamed or
    /// duplicated one fails the build rather than shipping a chronicle with the marker in it.
    /// </summary>
    private static string ReplaceOnce(string html, string marker, string value)
    {
        var parts = html.Split(marker);
        if (parts.Length != 2)
        {
            throw new InvalidOperationException(
                $"The chronicle template must contain \"{marker}\" exactly once, but it appears "
                + $"{parts.Length - 1} time(s). The template and the renderer are out of step.");
        }
        return string.Join(value, parts);
    }

    private static string Fill(string template, string project)
        => template.Replace("{project}", project, StringComparison.Ordinal);
}
