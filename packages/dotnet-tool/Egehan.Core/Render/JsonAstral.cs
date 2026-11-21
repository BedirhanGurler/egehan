using System.Globalization;
using System.Text;

namespace Egehan.Core.Render;

/// <summary>
/// Turns escaped surrogate pairs in serialised JSON back into the characters they stand for.
/// </summary>
/// <remarks>
/// <c>JSON.stringify</c> emits an emoji as itself; System.Text.Json emits it as
/// <c>🌱</c> even under the relaxed encoder, because its "all ranges" allow-list stops
/// at the end of the Basic Multilingual Plane. Both are valid JSON and parse to the same string —
/// but the two engines' HTML is compared byte for byte, and the dictionaries are full of emoji.
///
/// The scan counts consecutive backslashes before deciding whether one begins an escape, so a
/// string whose *content* is the literal text <c>\uD83C</c> (serialised as <c>\\uD83C</c>) is left
/// alone. Only a genuine escape introducing a high surrogate immediately followed by a low one is
/// collapsed; a lone surrogate, which would not be a valid character, is left exactly as it was.
/// </remarks>
public static class JsonAstral
{
    public static string Unescape(string json)
    {
        if (!json.Contains("\\u", StringComparison.Ordinal)) return json;

        var result = new StringBuilder(json.Length);
        var index = 0;

        while (index < json.Length)
        {
            if (json[index] != '\\')
            {
                result.Append(json[index]);
                index += 1;
                continue;
            }

            // A run of backslashes: only an odd-length run leaves one free to start an escape.
            var runStart = index;
            while (index < json.Length && json[index] == '\\') index += 1;
            var run = index - runStart;

            if (run % 2 == 0)
            {
                result.Append('\\', run);
                continue;
            }

            result.Append('\\', run - 1);

            if (TryReadPair(json, index, out var scalar, out var consumed))
            {
                result.Append(char.ConvertFromUtf32(scalar));
                index += consumed;
            }
            else
            {
                result.Append('\\');
            }
        }

        return result.ToString();
    }

    private static bool TryReadPair(string json, int index, out int scalar, out int consumed)
    {
        scalar = 0;
        consumed = 0;

        // "uXXXX\uYYYY" — eleven characters after the backslash this run left free.
        const int PairLength = 11;
        if (index + PairLength > json.Length) return false;
        if (json[index] != 'u' || json[index + 5] != '\\' || json[index + 6] != 'u') return false;

        if (!TryHex(json, index + 1, out var high) || !TryHex(json, index + 7, out var low)) return false;
        if (!char.IsHighSurrogate((char)high) || !char.IsLowSurrogate((char)low)) return false;

        scalar = char.ConvertToUtf32((char)high, (char)low);
        consumed = PairLength;
        return true;
    }

    private static bool TryHex(string json, int at, out int value)
        => int.TryParse(json.AsSpan(at, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value);
}
