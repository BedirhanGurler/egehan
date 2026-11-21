using System.Text.Json;
using System.Text.Json.Nodes;

namespace Egehan.Core.Tests;

/// <summary>
/// Locating and comparing the conformance fixtures shared with the Node engine.
/// </summary>
internal static class Fixtures
{
    /// <summary>
    /// Walks up from the test assembly to <c>packages/core-spec/fixtures</c>.
    /// </summary>
    /// <remarks>
    /// Found rather than configured: a hard-coded relative path breaks the moment somebody runs
    /// the tests from a different working directory, and the failure reads as "no fixtures" when
    /// it means "wrong directory".
    /// </remarks>
    public static string Directory()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);

        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "packages", "core-spec", "fixtures");
            if (System.IO.Directory.Exists(candidate)) return candidate;
            current = current.Parent;
        }

        throw new InvalidOperationException(
            "Could not find packages/core-spec/fixtures above " + AppContext.BaseDirectory);
    }

    /// <summary>
    /// A fixture is a directory with an <c>input.json</c>. <c>capsule/</c> sits beside them and
    /// holds interop material rather than a history, so it is not one.
    /// </summary>
    public static IEnumerable<string> Names()
        => System.IO.Directory.EnumerateDirectories(Directory())
            .Where(path => File.Exists(Path.Combine(path, "input.json")))
            .Select(path => Path.GetFileName(path)!)
            .OrderBy(name => name, StringComparer.Ordinal);

    public static JsonNode Read(string path)
        => JsonNode.Parse(File.ReadAllText(path))
            ?? throw new InvalidOperationException($"{path} is empty.");

    /// <summary>
    /// Deep comparison, reporting the first difference by path.
    /// </summary>
    /// <remarks>
    /// Structural rather than textual: the two engines are required to agree on the *report*, not
    /// on how their serialisers lay out whitespace or order object keys. Numbers are compared by
    /// value so that <c>2</c> and <c>2.0</c> do not read as a divergence.
    /// </remarks>
    public static string? FirstDifference(JsonNode? expected, JsonNode? actual, ISet<string> ignore, string path = "")
    {
        if (ignore.Contains(path)) return null;

        if (expected is null || actual is null)
        {
            return expected is null && actual is null ? null : $"{Where(path)}: expected {Show(expected)}, got {Show(actual)}";
        }

        switch (expected)
        {
            case JsonObject expectedObject:
            {
                if (actual is not JsonObject actualObject)
                {
                    return $"{Where(path)}: expected an object, got {Show(actual)}";
                }

                foreach (var property in expectedObject)
                {
                    if (!actualObject.ContainsKey(property.Key) && !ignore.Contains($"{path}.{property.Key}"))
                    {
                        return $"{Where(path)}: the .NET report is missing \"{property.Key}\"";
                    }
                }
                foreach (var property in actualObject)
                {
                    if (!expectedObject.ContainsKey(property.Key) && !ignore.Contains($"{path}.{property.Key}"))
                    {
                        return $"{Where(path)}: the .NET report has an extra \"{property.Key}\"";
                    }
                }

                foreach (var property in expectedObject)
                {
                    var difference = FirstDifference(
                        property.Value,
                        actualObject[property.Key],
                        ignore,
                        $"{path}.{property.Key}");
                    if (difference is not null) return difference;
                }

                return null;
            }

            case JsonArray expectedArray:
            {
                if (actual is not JsonArray actualArray)
                {
                    return $"{Where(path)}: expected an array, got {Show(actual)}";
                }
                if (expectedArray.Count != actualArray.Count)
                {
                    return $"{Where(path)}: expected {expectedArray.Count} items, got {actualArray.Count}";
                }

                for (var index = 0; index < expectedArray.Count; index += 1)
                {
                    var difference = FirstDifference(
                        expectedArray[index], actualArray[index], ignore, $"{path}[{index}]");
                    if (difference is not null) return difference;
                }

                return null;
            }

            default:
            {
                var expectedValue = expected.AsValue();
                var actualValue = actual is JsonValue value
                    ? value
                    : throw new InvalidOperationException($"{Where(path)}: expected a value, got {Show(actual)}");

                if (expectedValue.TryGetValue<double>(out var expectedNumber)
                    && actualValue.TryGetValue<double>(out var actualNumber))
                {
                    return Math.Abs(expectedNumber - actualNumber) < 1e-9
                        ? null
                        : $"{Where(path)}: expected {expectedNumber}, got {actualNumber}";
                }

                var expectedText = expectedValue.ToJsonString();
                var actualText = actualValue.ToJsonString();

                return string.Equals(expectedText, actualText, StringComparison.Ordinal)
                    ? null
                    : $"{Where(path)}:\n  node  : {expectedText}\n  dotnet: {actualText}";
            }
        }
    }

    private static string Where(string path) => path.Length == 0 ? "(root)" : path;

    private static string Show(JsonNode? node) => node?.ToJsonString() ?? "null";

    public static JsonSerializerOptions WriteOptions { get; } = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
    };
}
