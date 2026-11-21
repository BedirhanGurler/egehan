using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Egehan.Core.Spec;

/// <summary>
/// A narrative template: either a plain string, or an object declaring the data it needs.
/// </summary>
/// <remarks>
/// The object form exists so a sentence can say what it depends on — a milestone template
/// mentioning <c>{tag}</c> is useless for an untagged commit — and the engine filters on that
/// before making its deterministic choice. The common case stays a plain string because the
/// people most likely to edit these files are translators, not programmers.
/// </remarks>
public sealed record Template(string Text, IReadOnlyList<string> Requires);

internal sealed class TemplateConverter : JsonConverter<Template>
{
    public override Template Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            return new Template(reader.GetString() ?? "", []);
        }

        if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException("A narrative template must be a string or an object with a \"t\" field.");
        }

        string text = "";
        var requires = new List<string>();

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            var name = reader.GetString();
            reader.Read();

            switch (name)
            {
                case "t":
                    text = reader.GetString() ?? "";
                    break;
                case "requires":
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                    {
                        requires.Add(reader.GetString() ?? "");
                    }
                    break;
                default:
                    reader.Skip();
                    break;
            }
        }

        return new Template(text, requires);
    }

    public override void Write(Utf8JsonWriter writer, Template value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.Text);
}

/// <summary>
/// A dictionary whose <c>$</c>-prefixed keys are documentation rather than data.
/// </summary>
/// <remarks>
/// Several objects in the contract carry a <c>$comment</c> alongside their real entries, which is
/// how a JSON file explains itself. Without this the deserialiser would try to read that comment
/// as a value and fail — and the natural workaround, deleting the comments, would make the
/// contract harder to read for the sake of one language's parser.
/// </remarks>
internal sealed class CommentSkippingDictionaryConverter<TValue> : JsonConverter<IReadOnlyDictionary<string, TValue>>
{
    public override IReadOnlyDictionary<string, TValue> Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartObject) throw new JsonException("Expected an object.");

        var result = new Dictionary<string, TValue>(StringComparer.Ordinal);

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            var name = reader.GetString() ?? "";
            reader.Read();

            if (name.StartsWith('$'))
            {
                reader.Skip();
                continue;
            }

            var value = JsonSerializer.Deserialize<TValue>(ref reader, options);
            if (value is not null) result[name] = value;
        }

        return result;
    }

    public override void Write(
        Utf8JsonWriter writer,
        IReadOnlyDictionary<string, TValue> value,
        JsonSerializerOptions options) => throw new NotSupportedException();
}

public sealed record ToneVariants
{
    public IReadOnlyList<Template> Poetic { get; init; } = [];
    public IReadOnlyList<Template> Minimalist { get; init; } = [];
    public IReadOnlyList<Template> Humorous { get; init; } = [];

    public IReadOnlyList<Template> For(string tone) => tone switch
    {
        "poetic" => Poetic,
        "minimalist" => Minimalist,
        "humorous" => Humorous,
        _ => throw new InvalidOperationException($"Unknown tone \"{tone}\"."),
    };
}

public sealed record LocaleStrings
{
    public IReadOnlyList<string> Months { get; init; } = [];
    public IReadOnlyList<string> Weekdays { get; init; } = [];
    public IReadOnlyList<string> WeekdaysShort { get; init; } = [];
    public string DateFormat { get; init; } = "";
    public string DateShortFormat { get; init; } = "";
    public string TimeFormat { get; init; } = "";
    public string RangeFormat { get; init; } = "";
    public string RangeSameDayFormat { get; init; } = "";
    public string PeriodFormat { get; init; } = "";
    public string PeriodSameDayFormat { get; init; } = "";
    public string ListSeparator { get; init; } = ", ";
    public string ListLastSeparator { get; init; } = " and ";
}

public sealed record PluralForms
{
    public string One { get; init; } = "";
    public string Other { get; init; } = "";
}

public sealed record UnitStrings
{
    public PluralForms File { get; init; } = new();
    public PluralForms Line { get; init; } = new();
    public PluralForms Commit { get; init; } = new();
    public PluralForms Day { get; init; } = new();
    public PluralForms Author { get; init; } = new();
    public string Format { get; init; } = "{n} {unit}";
}

public sealed record FlavorVocabulary
{
    public string Subject { get; init; } = "";
    public string Artifact { get; init; } = "";
    public string Layer { get; init; } = "";
    public string Domain { get; init; } = "";
}

public sealed record CategoryNarratives
{
    public string Label { get; init; } = "";
    public string Icon { get; init; } = "";
    public ToneVariants ChapterTitles { get; init; } = new();
    public ToneVariants ChapterNarratives { get; init; } = new();
    public ToneVariants Entries { get; init; } = new();
}

public sealed record ChronotypeNarratives
{
    public string Label { get; init; } = "";
    public string Icon { get; init; } = "";
    public ToneVariants Narratives { get; init; } = new();
}

public sealed record CreationStrings
{
    public string Building { get; init; } = "";
    public string Refining { get; init; } = "";
    public string Balanced { get; init; } = "";
}

public sealed record StreakStrings
{
    public string Longest { get; init; } = "";
    public string Current { get; init; } = "";
    public string None { get; init; } = "";
}

public sealed record PulseStrings
{
    public string Title { get; init; } = "";
    public IReadOnlyDictionary<string, ChronotypeNarratives> Chronotypes { get; init; } = new Dictionary<string, ChronotypeNarratives>();
    public CreationStrings Creation { get; init; } = new();
    public StreakStrings Streak { get; init; } = new();
    public IReadOnlyDictionary<string, string> Labels { get; init; } = new Dictionary<string, string>();
}

public sealed record CelebrationStrings
{
    public string Title { get; init; } = "";
    public string Action { get; init; } = "";
}

public sealed record MilestoneStrings
{
    [JsonPropertyName("first-commit")] public string FirstCommit { get; init; } = "";
    [JsonPropertyName("commit-count")] public string CommitCount { get; init; } = "";
    [JsonPropertyName("release-tag")] public string ReleaseTag { get; init; } = "";
    [JsonPropertyName("anniversary")] public string Anniversary { get; init; } = "";
    [JsonPropertyName("streak")] public string Streak { get; init; } = "";
    [JsonPropertyName("midnight-fix")] public string MidnightFix { get; init; } = "";
    [JsonPropertyName("architectural-leap")] public string ArchitecturalLeap { get; init; } = "";
    [JsonPropertyName("celebration")] public CelebrationStrings Celebration { get; init; } = new();

    public string For(string kind) => kind switch
    {
        "first-commit" => FirstCommit,
        "commit-count" => CommitCount,
        "release-tag" => ReleaseTag,
        "anniversary" => Anniversary,
        "streak" => Streak,
        "midnight-fix" => MidnightFix,
        "architectural-leap" => ArchitecturalLeap,
        _ => throw new InvalidOperationException($"The dictionary has no milestone text for \"{kind}\"."),
    };
}

[SuppressMessage(
    "Naming",
    "CA1711:Identifiers should not have incorrect suffix",
    Justification =
        "\"Dictionary\" here is the linguistic sense — a book of words and phrases — not a map. " +
        "The Node engine calls the same thing a dictionary, and renaming one side would make the " +
        "two implementations of one contract read as two different designs.")]
public sealed record NarrativeDictionary
{
    public string Language { get; init; } = "";
    public string Version { get; init; } = "";
    public LocaleStrings Locale { get; init; } = new();
    public UnitStrings Units { get; init; } = new();
    public IReadOnlyDictionary<string, FlavorVocabulary> Flavors { get; init; } = new Dictionary<string, FlavorVocabulary>();
    public IReadOnlyDictionary<string, CategoryNarratives> Categories { get; init; } = new Dictionary<string, CategoryNarratives>();

    [JsonConverter(typeof(CommentSkippingDictionaryConverter<ToneVariants>))]
    public IReadOnlyDictionary<string, ToneVariants> Modifiers { get; init; } = new Dictionary<string, ToneVariants>();

    public PulseStrings Pulse { get; init; } = new();
    public MilestoneStrings Milestones { get; init; } = new();
    public IReadOnlyDictionary<string, string> Ui { get; init; } = new Dictionary<string, string>();

    private static readonly Dictionary<string, NarrativeDictionary> Cache = new(StringComparer.Ordinal);

    private static readonly JsonSerializerOptions Options = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = false,
        };
        options.Converters.Add(new TemplateConverter());
        return options;
    }

    public static NarrativeDictionary Load(string language)
    {
        lock (Cache)
        {
            if (Cache.TryGetValue(language, out var cached)) return cached;

            var available = EmbeddedAssets.AvailableLanguages();
            if (!available.Contains(language))
            {
                throw new InvalidOperationException(
                    $"No dictionary for language \"{language}\". Available: {string.Join(", ", available)}. " +
                    "Adding one means adding a JSON file — see CONTRIBUTING.md.");
            }

            var loaded = JsonSerializer.Deserialize<NarrativeDictionary>(EmbeddedAssets.ReadDictionary(language), Options)
                ?? throw new InvalidOperationException($"narratives.{language}.json could not be read.");

            Cache[language] = loaded;
            return loaded;
        }
    }

    public CategoryNarratives RequireCategory(string category)
        => Categories.TryGetValue(category, out var found)
            ? found
            : throw new InvalidOperationException($"The dictionary has no narratives for category \"{category}\".");

    public string UiString(string key) => Ui.TryGetValue(key, out var value) ? value : "";

    public string Label(string key) => Pulse.Labels.TryGetValue(key, out var value) ? value : "";
}
