using System.Text.Json;
using Egehan.Core.Capsule;
using Egehan.Core.Model;
using Egehan.Core.Render;
using Egehan.Core.Spec;
using Xunit;

namespace Egehan.Core.Tests;

/// <summary>
/// The capsule, across engines.
/// </summary>
/// <remarks>
/// A capsule has to survive three implementations of the same parameters: Node seals it, the
/// browser's Web Crypto opens it from the generated page, and this engine opens it from the .NET
/// tool. A disagreement about any of PBKDF2's inputs, where the GCM tag goes, or the additional
/// authenticated data would make somebody's letter unreadable in the one place they meant to read
/// it — while each engine's own tests carried on passing.
/// </remarks>
public sealed class CapsuleInteropTests
{
    private const string Passphrase = "conformance-test-passphrase";

    private static SealedCapsule SealedByNode()
    {
        var path = Path.Combine(Fixtures.Directory(), "capsule", "sealed-by-node.json");
        Assert.True(File.Exists(path), $"The interop fixture {path} is missing.");
        return CapsuleStorage.ReadFile(path, EgehanRules.Load());
    }

    [Fact]
    public void A_capsule_sealed_by_the_node_engine_opens_here()
    {
        var message = TimeCapsule.Open(SealedByNode(), Passphrase, EgehanRules.Load());

        Assert.Contains("Node motoru tarafından mühürlendi", message, StringComparison.Ordinal);
        Assert.Contains("ğüşıöç ĞÜŞİÖÇ", message, StringComparison.Ordinal);
    }

    [Fact]
    public void The_wrong_passphrase_is_refused_the_same_way()
    {
        var error = Assert.Throws<CapsuleException>(
            () => TimeCapsule.Open(SealedByNode(), Passphrase + "x", EgehanRules.Load()));

        Assert.Contains("does not open this capsule", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Editing_the_unlock_date_breaks_a_capsule_sealed_elsewhere()
    {
        // The date is bound in as additional authenticated data by both engines, so tampering is
        // evident whichever one sealed it.
        var tampered = SealedByNode() with { UnlockDate = "2030-01-01" };

        Assert.Throws<CapsuleException>(() => TimeCapsule.Open(tampered, Passphrase, EgehanRules.Load()));
    }

    [Fact]
    public void A_capsule_sealed_here_round_trips()
    {
        var rules = EgehanRules.Load();
        var capsule = TimeCapsule.Seal(
            new SealInput("bir mesaj ğüşıöç", "2044-02-01", Passphrase, null, null, "2026-01-01T00:00:00+03:00"),
            rules);

        Assert.Equal("bir mesaj ğüşıöç", TimeCapsule.Open(capsule, Passphrase, rules));
        Assert.DoesNotContain("bir mesaj", JsonSerializer.Serialize(capsule), StringComparison.Ordinal);
    }

    [Fact]
    public void The_parameters_are_the_ones_the_contract_fixes()
    {
        var rules = EgehanRules.Load();
        var capsule = SealedByNode();

        Assert.Equal("sealed", capsule.Mode);
        Assert.Equal("PBKDF2", capsule.Algorithm.Kdf);
        Assert.Equal("AES-256-GCM", capsule.Algorithm.Cipher);
        Assert.Equal(rules.Capsule.Iterations, capsule.Algorithm.Iterations);
        Assert.Equal(rules.Capsule.SaltBytes, Convert.FromBase64String(capsule.Salt).Length);
        Assert.Equal(rules.Capsule.IvBytes, Convert.FromBase64String(capsule.Iv).Length);
    }

    [Fact]
    public void A_capsule_weakened_below_the_floor_is_refused()
    {
        var rules = EgehanRules.Load();
        var directory = Directory.CreateTempSubdirectory("egehan-capsule-");

        try
        {
            var weak = SealedByNode() with { Algorithm = new CapsuleAlgorithm { Iterations = 1000 } };
            var path = Path.Combine(directory.FullName, rules.Output.CapsuleFileName);
            File.WriteAllText(path, JsonSerializer.Serialize(weak));

            var error = Assert.Throws<CapsuleException>(() => CapsuleStorage.ReadFile(path, rules));
            Assert.Contains("far below", error.Message, StringComparison.Ordinal);
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }
}

/// <summary>
/// The astral unescaper, which exists so the two engines' HTML is byte-identical.
/// </summary>
public sealed class JsonAstralTests
{
    [Fact]
    public void A_surrogate_pair_becomes_the_character_it_stands_for()
    {
        Assert.Equal("\"🌱\"", JsonAstral.Unescape("\"\\uD83C\\uDF31\""));
        Assert.Equal("{\"icon\":\"🌙\"}", JsonAstral.Unescape("{\"icon\":\"\\uD83C\\uDF19\"}"));
    }

    [Fact]
    public void Text_with_no_escapes_is_returned_untouched()
    {
        Assert.Equal("{\"a\":\"ğüşıöç\"}", JsonAstral.Unescape("{\"a\":\"ğüşıöç\"}"));
        Assert.Equal("", JsonAstral.Unescape(""));
    }

    [Fact]
    public void An_escaped_backslash_is_not_mistaken_for_an_escape()
    {
        // A string whose *content* is the literal text 🌱 serialises with doubled
        // backslashes. Collapsing it would corrupt the data rather than tidy the encoding.
        Assert.Equal(@"""\\uD83C\\uDF31""", JsonAstral.Unescape(@"""\\uD83C\\uDF31"""));

        // Three backslashes: two are an escaped backslash, the third starts a real escape.
        Assert.Equal("\"\\\\🌱\"", JsonAstral.Unescape(@"""\\🌱"""));
    }

    [Fact]
    public void Non_surrogate_escapes_are_left_alone()
    {
        // Control characters and BMP escapes stay exactly as the serialiser wrote them; only the
        // astral pairs differ between the two engines.
        Assert.Equal(@"""\u0008""", JsonAstral.Unescape(@"""\u0008"""));
        Assert.Equal(@"""\n\t""", JsonAstral.Unescape(@"""\n\t"""));
        Assert.Equal(@"""ğ""", JsonAstral.Unescape(@"""ğ"""));
    }

    [Fact]
    public void A_lone_surrogate_is_left_alone_rather_than_producing_an_invalid_character()
    {
        Assert.Equal(@"""\uD83C""", JsonAstral.Unescape(@"""\uD83C"""));
        Assert.Equal(@"""\uDF31\uD83C""", JsonAstral.Unescape(@"""\uDF31\uD83C"""));
    }

    [Fact]
    public void A_truncated_escape_at_the_end_does_not_throw()
    {
        Assert.Equal(@"""\uD83", JsonAstral.Unescape(@"""\uD83"));
        Assert.Equal(@"\", JsonAstral.Unescape(@"\"));
    }
}
