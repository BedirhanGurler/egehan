using System.Globalization;
using System.Text.RegularExpressions;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// Turns a commit subject into a type, a scope and a sentence fragment a human wants to read.
/// </summary>
/// <remarks>
/// Two things decide whether this matches the Node engine exactly.
///
/// First, lowercasing is invariant, never culture-aware: <c>ToLower</c> under a Turkish culture
/// maps <c>I</c> to <c>ı</c>, so a Turkish machine would classify <c>FIX: …</c> differently from
/// an English one, and the output would depend on who ran the tool.
///
/// Second, JavaScript's <c>String.replace</c> with a non-global regex replaces only the first
/// match, while .NET's <c>Regex.Replace</c> replaces every one. Every cleanup step below passes
/// an explicit count of 1 for that reason; forgetting it is a divergence no unit test of either
/// engine alone would reveal.
/// </remarks>
public static class ConventionalCommits
{
    private static readonly HashSet<string> KnownTypes = new(StringComparer.Ordinal)
    {
        "feat", "fix", "docs", "style", "refactor", "perf", "test",
        "build", "ci", "chore", "revert", "merge", "unknown",
    };

    private static readonly Regex BreakingChange = new(
        @"^BREAKING[ -]CHANGE:",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);

    private static readonly Regex Tokens = new(@"[\p{L}\p{N}]+", RegexOptions.CultureInvariant);

    public sealed record ParsedSubject(ConventionalInfo Conventional, string CleanSubject);

    public static ParsedSubject ParseSubject(NormalizedCommit commit, EgehanRules rules, string language)
    {
        var spec = rules.ConventionalCommits;
        var subject = commit.Subject.Trim();
        var isMerge = commit.Parents.Count > 1 || new Regex(spec.MergePattern).IsMatch(subject);

        var explicitMatch = new Regex(spec.Pattern).Match(subject);
        if (explicitMatch.Success)
        {
            var declared = NormalizeType(explicitMatch.Groups["type"].Value, spec.TypeAliases);
            var scope = explicitMatch.Groups["scope"].Success ? explicitMatch.Groups["scope"].Value.Trim() : "";

            return new ParsedSubject(
                new ConventionalInfo
                {
                    Type = declared,
                    Scope = scope.Length == 0 ? null : scope,
                    Breaking = explicitMatch.Groups["breaking"].Value == "!" || MentionsBreakingChange(commit.Body),
                    Inferred = false,
                },
                CleanSubject(explicitMatch.Groups["subject"].Value, rules, language));
        }

        if (isMerge)
        {
            return new ParsedSubject(
                new ConventionalInfo { Type = "merge", Scope = null, Breaking = false, Inferred = true },
                CleanSubject(subject, rules, language));
        }

        if (new Regex(spec.RevertPattern).IsMatch(subject))
        {
            return new ParsedSubject(
                new ConventionalInfo { Type = "revert", Scope = null, Breaking = false, Inferred = true },
                CleanSubject(subject, rules, language));
        }

        return new ParsedSubject(
            new ConventionalInfo
            {
                Type = InferTypeFromKeywords(subject, rules),
                Scope = null,
                Breaking = MentionsBreakingChange(commit.Body),
                Inferred = true,
            },
            CleanSubject(subject, rules, language));
    }

    private static string NormalizeType(string raw, IReadOnlyDictionary<string, string> aliases)
    {
        var lowered = raw.ToLowerInvariant();
        var canonical = aliases.TryGetValue(lowered, out var mapped) ? mapped : lowered;
        return KnownTypes.Contains(canonical) ? canonical : "unknown";
    }

    /// <summary>
    /// Keyword fallback, so a repository that never adopted Conventional Commits still gets a story.
    /// </summary>
    /// <remarks>
    /// The groups are walked in <c>keywordFallbackOrder</c> rather than in map order. A
    /// <see cref="Dictionary{TKey,TValue}"/> gives no ordering guarantee, so iterating it would
    /// let this engine classify a subject differently from the Node one — which is precisely why
    /// the order is written down in the contract.
    /// </remarks>
    private static string InferTypeFromKeywords(string subject, EgehanRules rules)
    {
        var spec = rules.ConventionalCommits;
        var fallback = spec.KeywordFallback();

        var tokens = Tokens.Matches(subject.ToLowerInvariant()).Select(match => match.Value).ToList();
        if (tokens.Count == 0) return "unknown";

        var words = new HashSet<string>(tokens, StringComparer.Ordinal);
        var joined = string.Join(' ', tokens);

        foreach (var group in spec.KeywordFallbackOrder)
        {
            if (!fallback.TryGetValue(group, out var keywords)) continue;

            foreach (var keyword in keywords)
            {
                var matched = keyword.Contains(' ', StringComparison.Ordinal)
                    ? joined.Contains(keyword, StringComparison.Ordinal)
                    : words.Contains(keyword);

                if (matched) return KnownTypes.Contains(group) ? group : "unknown";
            }
        }

        return "unknown";
    }

    private static bool MentionsBreakingChange(string body) => BreakingChange.IsMatch(body);

    /// <summary>
    /// <c>fix(auth): token refresh race condition [EGE-128].</c> → <c>token refresh race condition</c>
    /// </summary>
    public static string CleanSubject(string raw, EgehanRules rules, string language)
    {
        var spec = rules.ConventionalCommits.SubjectCleanup;
        var text = raw;

        // Count 1 on both: the Node engine uses a non-global regex, which replaces once.
        text = new Regex(spec.StripPrefixPattern).Replace(text, "", 1);
        text = new Regex(spec.StripTicketPattern).Replace(text, "", 1);

        if (spec.CollapseWhitespace)
        {
            text = Regex.Replace(text, @"\s+", " ").Trim();
        }
        if (spec.StripTrailingPeriod)
        {
            text = Regex.Replace(text, @"\.+$", "", RegexOptions.None);
        }
        if (text.Length > spec.MaxLength)
        {
            text = string.Concat(text.AsSpan(0, spec.MaxLength - spec.Ellipsis.Length).TrimEnd(), spec.Ellipsis);
        }
        if (spec.CapitalizeFirstLetter && text.Length > 0)
        {
            var culture = CultureInfo.GetCultureInfo(language);
            text = culture.TextInfo.ToUpper(text[0]) + text[1..];
        }

        return text.Length == 0 ? raw.Trim() : text;
    }
}
