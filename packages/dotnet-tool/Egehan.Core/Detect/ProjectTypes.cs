using System.Text.RegularExpressions;
using Egehan.Core.Spec;

namespace Egehan.Core.Detect;

/// <summary>
/// Works out what kind of project this is, so the narration can borrow its vocabulary.
/// </summary>
/// <remarks>
/// The scan is shallow by design: walking a whole repository to find a <c>.csproj</c> would make
/// the tool slow on exactly the large repositories where it is most interesting, and a project
/// declares its identity at its root in practice. Detection is split from scanning so the rules
/// can be tested against a synthetic file list rather than a temporary directory tree.
/// </remarks>
public sealed record FileSystemView(IReadOnlyList<string> Files, IReadOnlyList<string> Directories);

public sealed record ProjectTypeResult(IReadOnlyList<string> DetectedTypes, string Flavor);

public static class ProjectTypes
{
    public static FileSystemView Scan(string root, EgehanRules rules)
    {
        var ignored = new HashSet<string>(rules.ProjectTypes.IgnoreDirs, StringComparer.Ordinal);
        var files = new List<string>();
        var directories = new List<string>();

        void Walk(string absolute, string relative, int depth)
        {
            string[] entries;
            try
            {
                entries = Directory.GetFileSystemEntries(absolute);
            }
            catch (IOException)
            {
                return; // an unreadable directory is not worth failing a chronicle over
            }
            catch (UnauthorizedAccessException)
            {
                return;
            }

            foreach (var entry in entries)
            {
                var name = Path.GetFileName(entry);
                var child = relative.Length == 0 ? name : $"{relative}/{name}";

                if (Directory.Exists(entry))
                {
                    if (ignored.Contains(name) || name.StartsWith('.')) continue;
                    directories.Add(child);
                    if (depth < rules.ProjectTypes.MaxDepth) Walk(entry, child, depth + 1);
                }
                else
                {
                    files.Add(child);
                }
            }
        }

        Walk(root, "", 0);

        files.Sort(StringComparer.Ordinal);
        directories.Sort(StringComparer.Ordinal);

        return new FileSystemView(files, directories);
    }

    public static ProjectTypeResult Detect(FileSystemView view, EgehanRules rules)
    {
        var fileSet = new HashSet<string>(view.Files, StringComparer.Ordinal);
        var directorySet = new HashSet<string>(view.Directories, StringComparer.Ordinal);

        var matched = rules.ProjectTypes.Detectors
            .Where(detector =>
                detector.AnyFile?.Any(fileSet.Contains) == true
                || detector.AnyGlob?.Any(pattern => MatchesGlob(pattern, view.Files)) == true
                || (detector.AllDirs is { Count: > 0 } dirs && dirs.All(directorySet.Contains)))
            // Priority descending, then id, so equal priorities cannot reorder between runs. The
            // comparison is ordinal: a locale-aware one would make detection depend on the
            // machine's culture.
            .OrderByDescending(detector => detector.Priority)
            .ThenBy(detector => detector.Id, StringComparer.Ordinal)
            .ToList();

        return new ProjectTypeResult(
            matched.Select(detector => detector.Id).ToList(),
            matched.Count > 0 ? matched[0].Flavor : rules.ProjectTypes.FallbackFlavor);
    }

    public static bool MatchesGlob(string pattern, IReadOnlyList<string> paths)
    {
        var regex = GlobToRegex(pattern);
        return paths.Any(path => regex.IsMatch(path));
    }

    /// <summary>
    /// A deliberately tiny glob matcher: <c>*</c> matches within one segment, <c>**</c> crosses them.
    /// </summary>
    public static Regex GlobToRegex(string pattern)
    {
        var source = new System.Text.StringBuilder("^");

        for (var index = 0; index < pattern.Length; index += 1)
        {
            var character = pattern[index];

            if (character == '*')
            {
                if (index + 1 < pattern.Length && pattern[index + 1] == '*')
                {
                    // `**/` may also match zero directories, so `**/*.csproj` matches at the root.
                    if (index + 2 < pattern.Length && pattern[index + 2] == '/')
                    {
                        source.Append("(?:[^/]+/)*");
                        index += 2;
                    }
                    else
                    {
                        source.Append(".*");
                        index += 1;
                    }
                }
                else
                {
                    source.Append("[^/]*");
                }
                continue;
            }

            if (character == '?')
            {
                source.Append("[^/]");
                continue;
            }

            source.Append(Regex.Escape(character.ToString()));
        }

        return new Regex(source.Append('$').ToString(), RegexOptions.CultureInvariant);
    }
}
