using System.Text.Json;
using Egehan.Core.Model;
using Egehan.Core.Render;
using Egehan.Core.Spec;

namespace Egehan.Core;

/// <summary>
/// Writing the chronicle to disk.
/// </summary>
/// <remarks>
/// The whole project rests on the file a git hook writes and the file an editor command writes
/// being the same file. Two copies of this logic would be two chances for them to stop being so —
/// which is also why the JSON report is the only artifact that carries a generation timestamp.
/// </remarks>
public static class Artifacts
{
    private static readonly JsonSerializerOptions ReportOptions = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Returns the absolute paths written, in a stable order.</summary>
    public static IReadOnlyList<string> Write(
        EgehanReport report,
        NarrativeDictionary dictionary,
        EgehanRules rules,
        string outputDirectory,
        string format)
    {
        var directory = Path.GetFullPath(outputDirectory);
        Directory.CreateDirectory(directory);

        // `both` is the pair a project keeps; the JSON report is the machine format, opt-in.
        bool Wants(string candidate)
            => format == candidate || format == "all" || (format == "both" && candidate != "json");

        var written = new List<string>();

        if (Wants("md"))
        {
            var path = Path.Combine(directory, rules.Output.MarkdownFileName);
            File.WriteAllText(path, MarkdownRenderer.Render(report, dictionary, rules));
            written.Add(path);
        }

        if (Wants("html"))
        {
            var path = Path.Combine(directory, rules.Output.HtmlFileName);
            File.WriteAllText(path, HtmlRenderer.Render(report, dictionary, rules));
            written.Add(path);
        }

        if (Wants("json"))
        {
            var path = Path.Combine(directory, rules.Output.ReportFileName);
            File.WriteAllText(path, JsonAstral.Unescape(JsonSerializer.Serialize(report, ReportOptions)) + "\n");
            written.Add(path);
        }

        return written;
    }
}
