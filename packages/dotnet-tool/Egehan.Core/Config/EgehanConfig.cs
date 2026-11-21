using System.Text.Json;
using System.Text.Json.Nodes;
using Egehan.Core.Spec;

namespace Egehan.Core.Config;

/// <summary>
/// <c>.egehanrc.json</c> — the per-project settings file.
/// </summary>
/// <remarks>
/// Validation is strict and the messages name the offending key and the accepted values. A config
/// file is edited by hand, usually months after it was written, and "invalid configuration" with
/// no further detail is how a tool teaches people to delete the file and start over.
///
/// Note what is not here: nothing that would change the narration on one machine but not another.
/// Language and tone are project-wide decisions recorded in the file, so two developers running
/// the tool on the same repository produce the same chronicle.
/// </remarks>
public sealed class ConfigException(string message) : InvalidOperationException(message);

public sealed record EgehanConfig
{
    public string? ProjectName { get; init; }

    /// <summary>Opt-in, free text, never generated.</summary>
    public string? Dedication { get; init; }

    public string Language { get; init; } = "en";
    public string Tone { get; init; } = "poetic";
    public string Theme { get; init; } = "auto";
    public bool RedactEmails { get; init; } = true;
    public bool AnonymizeAuthors { get; init; }
    public bool IncludeMergeCommits { get; init; }
    public string Format { get; init; } = "both";
    public string Output { get; init; } = ".";

    public static readonly string[] Tones = ["poetic", "minimalist", "humorous"];
    public static readonly string[] Formats = ["md", "html", "json", "both", "all"];
    public static readonly string[] Themes = ["auto", "light", "dark"];

    private static readonly string[] KnownKeys =
    [
        "projectName", "dedication", "language", "tone", "theme",
        "redactEmails", "anonymizeAuthors", "includeMergeCommits", "format", "output",
    ];

    public static EgehanConfig Default(EgehanRules rules) => new()
    {
        // The privacy default comes from the rules file, not from this code, so it is reviewable
        // in one place alongside the reason it exists.
        RedactEmails = rules.Privacy.RedactEmailsByDefault,
    };

    public static string PathFor(string root, EgehanRules rules)
        => System.IO.Path.Combine(root, rules.Output.ConfigFileName);

    public static bool Exists(string root, EgehanRules rules) => File.Exists(PathFor(root, rules));

    public static EgehanConfig Load(string root, EgehanRules rules)
    {
        var path = PathFor(root, rules);
        if (!File.Exists(path)) return Default(rules);

        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(File.ReadAllText(path));
        }
        catch (JsonException error)
        {
            throw new ConfigException($"{rules.Output.ConfigFileName} is not valid JSON: {error.Message}");
        }

        return Merge(Default(rules), parsed, rules.Output.ConfigFileName);
    }

    /// <summary>Applies a partial object over a base config, validating as it goes.</summary>
    public static EgehanConfig Merge(EgehanConfig baseConfig, JsonNode? patch, string source)
    {
        if (patch is not JsonObject raw) throw new ConfigException($"{source} must contain a JSON object.");

        foreach (var property in raw)
        {
            if (property.Key.StartsWith('$')) continue;
            if (!KnownKeys.Contains(property.Key, StringComparer.Ordinal))
            {
                throw new ConfigException(
                    $"{source} has an unknown setting \"{property.Key}\". " +
                    $"Known settings: {string.Join(", ", KnownKeys)}.");
            }
        }

        return new EgehanConfig
        {
            ProjectName = OptionalString(raw, "projectName", baseConfig.ProjectName, source),
            Dedication = OptionalString(raw, "dedication", baseConfig.Dedication, source),
            Language = OneOf(raw, "language", baseConfig.Language, EmbeddedAssets.AvailableLanguages(), source),
            Tone = OneOf(raw, "tone", baseConfig.Tone, Tones, source),
            Theme = OneOf(raw, "theme", baseConfig.Theme, Themes, source),
            RedactEmails = Boolean(raw, "redactEmails", baseConfig.RedactEmails, source),
            AnonymizeAuthors = Boolean(raw, "anonymizeAuthors", baseConfig.AnonymizeAuthors, source),
            IncludeMergeCommits = Boolean(raw, "includeMergeCommits", baseConfig.IncludeMergeCommits, source),
            Format = OneOf(raw, "format", baseConfig.Format, Formats, source),
            Output = RequiredString(raw, "output", baseConfig.Output, source),
        };
    }

    public string Serialize()
    {
        var body = new JsonObject
        {
            ["$schema"] = "https://github.com/bedirhangurler/egehan/schema/egehanrc.schema.json",
            ["projectName"] = ProjectName,
            ["dedication"] = Dedication,
            ["language"] = Language,
            ["tone"] = Tone,
            ["theme"] = Theme,
            ["redactEmails"] = RedactEmails,
            ["anonymizeAuthors"] = AnonymizeAuthors,
            ["includeMergeCommits"] = IncludeMergeCommits,
            ["format"] = Format,
            ["output"] = Output,
        };

        return body.ToJsonString(new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        }) + "\n";
    }

    private static string? OptionalString(JsonObject raw, string key, string? fallback, string source)
    {
        if (!raw.TryGetPropertyValue(key, out var node)) return fallback;
        if (node is null) return null;
        if (node.GetValueKind() != JsonValueKind.String)
        {
            throw new ConfigException($"{source}: \"{key}\" must be a string or null.");
        }

        var value = node.GetValue<string>().Trim();
        return value.Length == 0 ? null : value;
    }

    private static string RequiredString(JsonObject raw, string key, string fallback, string source)
    {
        if (!raw.TryGetPropertyValue(key, out var node)) return fallback;
        if (node?.GetValueKind() != JsonValueKind.String || node.GetValue<string>().Trim().Length == 0)
        {
            throw new ConfigException($"{source}: \"{key}\" must be a non-empty string.");
        }
        return node.GetValue<string>().Trim();
    }

    private static bool Boolean(JsonObject raw, string key, bool fallback, string source)
    {
        if (!raw.TryGetPropertyValue(key, out var node)) return fallback;
        var kind = node?.GetValueKind();
        if (kind != JsonValueKind.True && kind != JsonValueKind.False)
        {
            throw new ConfigException($"{source}: \"{key}\" must be true or false.");
        }
        return node!.GetValue<bool>();
    }

    private static string OneOf(
        JsonObject raw,
        string key,
        string fallback,
        IReadOnlyList<string> allowed,
        string source)
    {
        if (!raw.TryGetPropertyValue(key, out var node)) return fallback;

        var value = node?.GetValueKind() == JsonValueKind.String ? node.GetValue<string>() : null;
        if (value is null || !allowed.Contains(value, StringComparer.Ordinal))
        {
            throw new ConfigException($"{source}: \"{key}\" must be one of {string.Join(", ", allowed)}.");
        }
        return value;
    }
}
