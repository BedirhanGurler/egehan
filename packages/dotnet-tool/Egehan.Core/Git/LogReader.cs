using System.Globalization;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Git;

/// <summary>
/// Reads a repository's history into the engine's input shape.
/// </summary>
/// <remarks>
/// The last platform-specific stage: everything downstream consumes <see cref="NormalizedCommit"/>
/// and must behave identically in every runtime. Three details matter more than they look.
///
/// Records are delimited by control characters, because commit bodies contain newlines and a
/// newline-delimited format mis-parses any commit with a paragraph in it. Tags come from
/// <c>for-each-ref</c> rather than the log's decoration, because an annotated tag's object name is
/// not the commit's and decoration-based parsing silently loses exactly the releases a project
/// cared enough to annotate. And the commits are re-sorted chronologically, because <c>git log</c>
/// is topological while fix clustering and streaks are chronological.
/// </remarks>
public sealed record History(IReadOnlyList<NormalizedCommit> Commits, bool Truncated);

public static class LogReader
{
    private const string Record = "\u001e";
    private const string Field = "\u001f";
    private const int FixedFieldCount = 8;

    /// <summary>Eight fixed fields, then the body, then a separator so numstat is always last.</summary>
    private const string PrettyFormat =
        Record + "%H" + Field + "%h" + Field + "%P" + Field + "%an" + Field + "%ae" + Field
        + "%aI" + Field + "%cI" + Field + "%s" + Field + "%b" + Field;

    public static History Read(GitRunner git, string? since, string? until, EgehanRules rules, int? maxCommits = null)
    {
        var ceiling = rules.Limits.MaxCommitsPerRun;
        var limit = maxCommits is null or <= 0 ? ceiling : Math.Min(ceiling, maxCommits.Value);

        var arguments = new List<string>
        {
            "log",
            "--reverse",
            "--numstat",
            $"--max-count={limit.ToString(CultureInfo.InvariantCulture)}",
            $"--pretty=format:{PrettyFormat}",
        };
        arguments.AddRange(RangeArguments(git, since, until));

        var output = git.Run([.. arguments]);
        var tags = ReadTags(git);

        var commits = output
            .Split(Record, StringSplitOptions.None)
            .Skip(1) // the format emits a leading separator
            .Select(record => ParseRecord(record, tags, rules))
            .OfType<NormalizedCommit>()
            .ToList();

        return new History(SortChronologically(commits), commits.Count >= limit);
    }

    /// <summary>
    /// Turns <c>--since</c> / <c>--until</c> into git arguments.
    /// </summary>
    /// <remarks>
    /// Users pass whichever they have: a tag, a revision or a date. Probing with
    /// <c>rev-parse</c> tells the two apart, so both work without anyone having to know which
    /// form the tool wanted.
    /// </remarks>
    private static IEnumerable<string> RangeArguments(GitRunner git, string? since, string? until)
    {
        var sinceIsRevision = since is not null && Repository.IsRevision(git, since);
        var untilIsRevision = until is not null && Repository.IsRevision(git, until);

        if (sinceIsRevision && untilIsRevision) yield return $"{since}..{until}";
        else if (sinceIsRevision) yield return $"{since}..HEAD";
        else if (untilIsRevision) yield return until!;

        if (since is not null && !sinceIsRevision) yield return $"--since={since}";
        if (until is not null && !untilIsRevision) yield return $"--until={until}";
    }

    private static NormalizedCommit? ParseRecord(
        string record,
        Dictionary<string, List<string>> tags,
        EgehanRules rules)
    {
        var trimmed = record.TrimStart('\n');
        if (trimmed.Trim().Length == 0) return null;

        var parts = trimmed.Split(Field);
        if (parts.Length < FixedFieldCount + 2) return null;

        var sha = parts[0];
        var parentList = parts[2].Trim();

        // The body may itself contain the field separator; numstat is always the final part.
        var body = string.Join(Field, parts[FixedFieldCount..^1]);
        var numstat = parts[^1];

        return new NormalizedCommit
        {
            Sha = sha,
            Parents = parentList.Length == 0
                ? []
                : parentList.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList(),
            AuthorName = parts[3],
            AuthorEmail = parts[4],
            AuthoredAt = parts[5],
            CommittedAt = parts[6],
            Subject = Truncate(parts[7], rules.Git.MaxSubjectLength),
            Body = body.Trim(),
            Tags = tags.TryGetValue(sha, out var found) ? found : [],
            Files = ParseNumstat(numstat),
        };
    }

    /// <summary>
    /// Parses <c>--numstat</c> lines.
    /// </summary>
    /// <remarks>
    /// Binary files report <c>-</c> instead of a count; they are kept with zero lines, because a
    /// commit that added a 4 MB asset did touch a file. Renames arrive as <c>old =&gt; new</c> and
    /// are recorded verbatim: inventing a canonical path would make the file count disagree with
    /// what the developer sees in <c>git show</c>.
    /// </remarks>
    private static List<ChangedFile> ParseNumstat(string block)
    {
        var files = new List<ChangedFile>();

        foreach (var line in block.Split('\n'))
        {
            if (line.Trim().Length == 0) continue;

            var columns = line.Split('\t');
            if (columns.Length < 3) continue;

            var path = string.Join('\t', columns[2..]).Trim();
            if (path.Length == 0) continue;

            files.Add(new ChangedFile(path, ParseCount(columns[0]), ParseCount(columns[1])));
        }

        return files;
    }

    private static int ParseCount(string value)
        => value == "-" ? 0 : (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0);

    /// <summary>sha → tag names, resolving annotated tags to the commit they point at.</summary>
    public static Dictionary<string, List<string>> ReadTags(GitRunner git)
    {
        var output = git.Run(
            "for-each-ref",
            "refs/tags",
            $"--format=%(objectname){Field}%(*objectname){Field}%(refname:short)");

        var tags = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        foreach (var line in output.Split('\n'))
        {
            if (line.Trim().Length == 0) continue;

            var parts = line.Split(Field);
            if (parts.Length < 3) continue;

            // For an annotated tag %(*objectname) is the commit; for a lightweight one it is empty.
            var sha = parts[1].Trim().Length > 0 ? parts[1].Trim() : parts[0].Trim();
            var name = parts[2].Trim();
            if (sha.Length == 0 || name.Length == 0) continue;

            if (!tags.TryGetValue(sha, out var names))
            {
                names = [];
                tags[sha] = names;
            }
            names.Add(name);
        }

        // Several tags on one commit are sorted, so the first one the narrator picks is stable.
        foreach (var names in tags.Values) names.Sort(StringComparer.Ordinal);

        return tags;
    }

    private static List<NormalizedCommit> SortChronologically(List<NormalizedCommit> commits)
        => commits
            .OrderBy(commit => DateTimeOffset.Parse(commit.AuthoredAt, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds())
            .ThenBy(commit => DateTimeOffset.Parse(commit.CommittedAt, CultureInfo.InvariantCulture).ToUnixTimeMilliseconds())
            .ThenBy(commit => commit.Sha, StringComparer.Ordinal)
            .ToList();

    private static string Truncate(string value, int maxLength)
        => value.Length <= maxLength ? value : value[..maxLength];
}
