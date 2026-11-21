using System.Text.Json;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Capsule;

/// <summary>
/// Where a capsule lives on disk.
/// </summary>
/// <remarks>
/// Separate from the command layer so the pipeline can pick a capsule up without reaching into
/// the CLI: `generate` embeds whatever capsule the repository has, and an embedder calling the
/// library must get the same chronicle the CLI would write.
/// </remarks>
public static class CapsuleStorage
{
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string PathFor(string root, string? over, EgehanRules rules)
    {
        if (string.IsNullOrWhiteSpace(over)) return Path.Combine(root, rules.Output.CapsuleFileName);
        return Path.IsPathRooted(over) ? over : Path.GetFullPath(Path.Combine(root, over));
    }

    public static void Save(string path, SealedCapsule capsule)
        => File.WriteAllText(path, JsonSerializer.Serialize(capsule, WriteOptions) + "\n");

    public static SealedCapsule ReadFile(string path, EgehanRules rules)
    {
        SealedCapsule? capsule;

        try
        {
            capsule = JsonSerializer.Deserialize<SealedCapsule>(File.ReadAllText(path));
        }
        catch (Exception error) when (error is JsonException or IOException)
        {
            throw new CapsuleException($"The capsule at {path} could not be read: {error.Message}");
        }

        if (capsule is null) throw new CapsuleException($"The capsule at {path} is empty.");

        if (capsule.Mode != "sealed")
        {
            throw new CapsuleException(
                $"The capsule at {path} declares mode \"{capsule.Mode}\". Only sealed capsules exist.");
        }
        if (capsule.Ciphertext.Length == 0 || capsule.Salt.Length == 0 || capsule.Iv.Length == 0)
        {
            throw new CapsuleException($"The capsule at {path} is missing its ciphertext.");
        }
        if (capsule.Algorithm.Iterations < 1)
        {
            throw new CapsuleException($"The capsule at {path} does not say how it was derived.");
        }

        // Refuse a capsule weakened below the floor rather than opening it and implying it was fine.
        if (capsule.Algorithm.Iterations < rules.Capsule.Iterations / 10)
        {
            throw new CapsuleException(
                $"The capsule at {path} was derived with {capsule.Algorithm.Iterations} iterations, far "
                + $"below the {rules.Capsule.Iterations} this version requires. Re-create it.");
        }

        return capsule;
    }

    /// <summary>The repository's own capsule, when it has one.</summary>
    public static SealedCapsule? Load(string root, EgehanRules rules)
    {
        var path = PathFor(root, null, rules);
        return File.Exists(path) ? ReadFile(path, rules) : null;
    }
}
