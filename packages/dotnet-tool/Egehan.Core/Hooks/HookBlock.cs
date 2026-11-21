using Egehan.Core.Spec;

namespace Egehan.Core.Hooks;

/// <summary>
/// The text Egehan writes into a git hook, and the surgery for putting it in and taking it out.
/// </summary>
/// <remarks>
/// The script itself lives in <c>core-spec/templates/hook.sh</c>, not in this file. It is content
/// both engines install, and a copy in each language is two copies to keep in step — the same
/// reason the narrative templates are data (docs/ARCHITECTURE.md, ADR-001). Everything the script
/// does and refuses to do is argued in ADR-006.
///
/// The surgery below is kept pure so that the thing that really matters — installing and
/// uninstalling leaving somebody else's hook exactly as it was — can be tested on strings.
/// </remarks>
public static class HookBlock
{
    public const string BeginMarker = "# >>> egehan >>>";
    public const string EndMarker = "# <<< egehan <<<";
    public const string Shebang = "#!/bin/sh";

    public static readonly string[] ManagedHooks = ["post-commit", "post-merge"];

    public static string Build(string hookName, string version)
    {
        var verb = hookName == "post-merge" ? "merge" : "commit";

        return EmbeddedAssets.Read("templates.hook.sh")
            .Replace("{version}", version, StringComparison.Ordinal)
            .Replace("{verb}", verb, StringComparison.Ordinal)
            .TrimEnd();
    }

    public static bool HasBlock(string content)
        => content.Contains(BeginMarker, StringComparison.Ordinal)
            && content.Contains(EndMarker, StringComparison.Ordinal);

    /// <summary>Adds or replaces the managed block, leaving everything outside it untouched.</summary>
    public static string WithBlock(string content, string block)
    {
        if (content.Trim().Length == 0) return $"{Shebang}\n\n{block}\n";

        if (HasBlock(content))
        {
            var start = content.IndexOf(BeginMarker, StringComparison.Ordinal);
            var end = content.IndexOf(EndMarker, StringComparison.Ordinal) + EndMarker.Length;
            return content[..start] + block + content[end..];
        }

        var body = content.EndsWith('\n') ? content : content + "\n";
        return $"{body}\n{block}\n";
    }

    /// <summary>Removes the managed block and nothing else.</summary>
    public static string WithoutBlock(string content)
    {
        if (!HasBlock(content)) return content;

        var start = content.IndexOf(BeginMarker, StringComparison.Ordinal);
        var end = content.IndexOf(EndMarker, StringComparison.Ordinal) + EndMarker.Length;

        var before = System.Text.RegularExpressions.Regex.Replace(content[..start], @"\n+$", "\n");
        var after = System.Text.RegularExpressions.Regex.Replace(content[end..], @"^\n+", "");

        var result = before + after;
        return result.Trim().Length == 0 ? "" : result;
    }

    /// <summary>True when a hook file has nothing left but a shebang and comments.</summary>
    public static bool IsEmptyScript(string content)
        => content
            .Split('\n')
            .Where(line => line.Trim().Length > 0 && !line.StartsWith("#!", StringComparison.Ordinal))
            .All(line => line.TrimStart().StartsWith('#'));
}
