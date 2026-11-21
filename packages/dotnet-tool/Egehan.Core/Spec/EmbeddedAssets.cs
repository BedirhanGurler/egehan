using System.Reflection;
using System.Text;

namespace Egehan.Core.Spec;

/// <summary>
/// Reads the core-spec assets embedded in this assembly.
/// </summary>
/// <remarks>
/// The rules, the dictionaries and the page template are compiled in rather than copied beside
/// the tool, because a global tool is installed as a single package and a missing file would turn
/// into a runtime failure on somebody else's machine. They are the same files the Node engine
/// reads — the csproj embeds them straight out of <c>packages/core-spec</c>, so the two cannot
/// drift (docs/ARCHITECTURE.md, ADR-001).
/// </remarks>
public static class EmbeddedAssets
{
    private const string Prefix = "Egehan.Core.";
    private static readonly Assembly Owner = typeof(EmbeddedAssets).Assembly;

    public static string Read(string logicalName)
    {
        var full = Prefix + logicalName;
        using var stream = Owner.GetManifestResourceStream(full)
            ?? throw new InvalidOperationException(
                $"The embedded asset \"{full}\" is missing. Available: " +
                string.Join(", ", Owner.GetManifestResourceNames()));

        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    /// <summary>
    /// Every language this build carries, sorted.
    /// </summary>
    /// <remarks>
    /// Discovered from the manifest rather than listed in code, so adding a language stays what
    /// it is on the Node side: adding one JSON file.
    /// </remarks>
    public static IReadOnlyList<string> AvailableLanguages()
    {
        const string marker = Prefix + "dictionary.narratives.";

        return Owner.GetManifestResourceNames()
            .Where(name => name.StartsWith(marker, StringComparison.Ordinal)
                && name.EndsWith(".json", StringComparison.Ordinal))
            .Select(name => name[marker.Length..^".json".Length])
            .Where(code => code.Length > 0 && !code.Contains('.', StringComparison.Ordinal))
            .OrderBy(code => code, StringComparer.Ordinal)
            .ToList();
    }

    public static string ReadDictionary(string language) => Read($"dictionary.narratives.{language}.json");

    public static string ReadRules() => Read("spec.rules.json");

    public static string ReadTemplate() => Read("templates.egehan-book.html");

    public static string ReadSchema() => Read("schema.egehan-report.schema.json");
}
