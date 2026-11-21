using System.Globalization;
using System.Text.RegularExpressions;
using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// Deterministic template selection and interpolation.
/// </summary>
/// <remarks>
/// The whole promise of the project rests on this: the same commit must always produce the same
/// sentence, in every runtime, for as long as the dictionary version stays the same. No
/// randomness, no clock, no iteration over an unordered map, no culture-sensitive comparison.
/// </remarks>
public static class Templating
{
    private static readonly Regex Placeholder = new(@"\{([A-Za-z][A-Za-z0-9]*)\}", RegexOptions.CultureInvariant);

    public sealed record Selection(string Text, int Index);

    /// <summary>parseInt(sha[0..8], 16) % length — the formula rules.json documents.</summary>
    public static int HashIndex(string sha, int length, EgehanRules rules)
    {
        if (length <= 0)
        {
            throw new InvalidOperationException("Cannot select a template from an empty variant list.");
        }

        var prefix = sha.ToLowerInvariant();
        prefix = prefix.Length <= rules.Determinism.HashPrefixLength
            ? prefix
            : prefix[..rules.Determinism.HashPrefixLength];

        if (!long.TryParse(prefix, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value))
        {
            throw new InvalidOperationException(
                $"Commit sha \"{sha}\" does not start with {rules.Determinism.HashPrefixLength} hex digits.");
        }

        return (int)(value % length);
    }

    public static Selection SelectAndFill(
        IReadOnlyList<Template> templates,
        string sha,
        IReadOnlyDictionary<string, string> values,
        EgehanRules rules,
        string where)
    {
        if (templates.Count == 0)
        {
            throw new InvalidOperationException($"The dictionary provides no variants for {where}.");
        }

        // Filtering happens before indexing, which keeps selection deterministic while letting the
        // dictionary carry sentences only some commits can use. If everything is filtered out the
        // unfiltered list is used: a dictionary that cannot narrate a commit is a bug, but
        // refusing to narrate would turn that bug into a missing chapter in somebody's keepsake.
        var usable = templates
            .Where(template => template.Requires.All(name => IsPresent(values, name)))
            .ToList();
        var pool = usable.Count > 0 ? usable : templates;

        var index = HashIndex(sha, pool.Count, rules);
        return new Selection(Interpolate(pool[index].Text, values, where), index);
    }

    /// <summary>
    /// Replaces every placeholder, and throws on an unknown one.
    /// </summary>
    /// <remarks>
    /// Throwing is deliberate: the alternative is shipping a literal <c>{fliesCount}</c> into a
    /// file somebody means to keep for years, silently.
    /// </remarks>
    public static string Interpolate(string template, IReadOnlyDictionary<string, string> values, string where)
        => Placeholder.Replace(template, match =>
        {
            var name = match.Groups[1].Value;
            if (!values.TryGetValue(name, out var value))
            {
                throw new InvalidOperationException(
                    $"The template for {where} interpolates {{{name}}}, which the engine does not provide. " +
                    "Run `npm run spec:validate` against the dictionary.");
            }
            return value;
        });

    private static bool IsPresent(IReadOnlyDictionary<string, string> values, string name)
    {
        if (!values.TryGetValue(name, out var value)) return false;
        var trimmed = value.Trim();
        return trimmed.Length > 0 && trimmed != "0";
    }

    /// <summary>
    /// Upper-cases the first letter of a generated sentence, with the report's own language tag.
    /// </summary>
    /// <remarks>
    /// Only when that first character is a letter. A template may open with a date or with the
    /// quoted subject, and upper-casing inside the quotation would rewrite a citation — which is
    /// how «initial commit» once became «İnitial commit».
    /// </remarks>
    public static string CapitalizeSentence(string text, EgehanRules rules, string language)
    {
        if (!rules.Narrative.CapitalizeFirstLetter || text.Length == 0) return text;
        if (rules.Narrative.SkipWhenFirstCharIsNotALetter && !char.IsLetter(text[0])) return text;

        var culture = CultureInfo.GetCultureInfo(language);
        return culture.TextInfo.ToUpper(text[0]) + text[1..];
    }
}
