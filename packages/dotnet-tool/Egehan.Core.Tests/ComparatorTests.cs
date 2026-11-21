using System.Text.Json.Nodes;
using Xunit;

namespace Egehan.Core.Tests;

/// <summary>
/// Tests for the comparator the conformance suite leans on.
/// </summary>
/// <remarks>
/// A comparison that cannot fail is not a comparison, and the conformance suite passing on the
/// first run is exactly the situation where that deserves proving rather than assuming.
/// </remarks>
public sealed class ComparatorTests
{
    private static readonly HashSet<string> Nothing = new(StringComparer.Ordinal);

    [Fact]
    public void Identical_documents_compare_equal()
    {
        var left = JsonNode.Parse("""{"a":1,"b":[1,2,{"c":"x"}]}""")!;
        var right = JsonNode.Parse("""{"a":1,"b":[1,2,{"c":"x"}]}""")!;

        Assert.Null(Fixtures.FirstDifference(left, right, Nothing));
    }

    [Theory]
    [InlineData("""{"a":1}""", """{"a":2}""", ".a")]
    [InlineData("""{"a":"x"}""", """{"a":"y"}""", ".a")]
    [InlineData("""{"a":[1,2]}""", """{"a":[1,2,3]}""", ".a")]
    [InlineData("""{"a":[1,2]}""", """{"a":[1,3]}""", ".a[1]")]
    [InlineData("""{"a":1}""", """{"a":1,"b":2}""", "extra")]
    [InlineData("""{"a":1,"b":2}""", """{"a":1}""", "missing")]
    [InlineData("""{"a":null}""", """{"a":1}""", ".a")]
    [InlineData("""{"a":{"b":1}}""", """{"a":{"b":1.5}}""", ".a.b")]
    [InlineData("""{"a":"1"}""", """{"a":1}""", ".a")]
    [InlineData("""{"a":true}""", """{"a":false}""", ".a")]
    public void A_difference_anywhere_is_reported(string left, string right, string expectedMention)
    {
        var difference = Fixtures.FirstDifference(JsonNode.Parse(left), JsonNode.Parse(right), Nothing);

        Assert.NotNull(difference);
        Assert.Contains(expectedMention, difference, StringComparison.Ordinal);
    }

    [Fact]
    public void An_ignored_path_is_not_reported()
    {
        var ignore = new HashSet<string>(StringComparer.Ordinal) { ".generator.platform" };

        var left = JsonNode.Parse("""{"generator":{"platform":"node","version":"1"}}""")!;
        var right = JsonNode.Parse("""{"generator":{"platform":"dotnet","version":"1"}}""")!;

        Assert.Null(Fixtures.FirstDifference(left, right, ignore));

        var moved = JsonNode.Parse("""{"generator":{"platform":"dotnet","version":"2"}}""")!;
        Assert.NotNull(Fixtures.FirstDifference(left, moved, ignore));
    }

    [Fact]
    public void Numbers_compare_by_value_rather_than_by_spelling()
    {
        // 2 and 2.0 are the same number; a textual comparison would call them a divergence and
        // send somebody hunting for a bug that is in the serialiser, not the engine.
        Assert.Null(Fixtures.FirstDifference(JsonNode.Parse("""{"a":2}"""), JsonNode.Parse("""{"a":2.0}"""), Nothing));
        Assert.NotNull(Fixtures.FirstDifference(JsonNode.Parse("""{"a":2}"""), JsonNode.Parse("""{"a":2.1}"""), Nothing));
    }
}
