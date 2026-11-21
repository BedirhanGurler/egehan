using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Capsule;

/// <summary>
/// The sealed time capsule.
/// </summary>
/// <remarks>
/// One mode exists. The ciphertext is embedded in an HTML file people publish, so anything the
/// file can decrypt on its own, every reader can decrypt too — a "no passphrase, just a date"
/// capsule would advertise encryption while providing none (docs/ARCHITECTURE.md, ADR-005).
///
/// PBKDF2 is not the strongest KDF .NET offers. It is chosen because the capsule must also open
/// in a browser, from the generated file, with no dependencies, and Web Crypto has PBKDF2 and
/// neither scrypt nor Argon2. Every parameter comes from the rules file so that a capsule sealed
/// by either engine opens in the other, and in the page.
/// </remarks>
public sealed class CapsuleException(string message) : InvalidOperationException(message);

public sealed record SealInput(
    string Message,
    string UnlockDate,
    string Passphrase,
    string? AuthorLabel,
    string? Hint,
    string CreatedAt);

public static class TimeCapsule
{
    private static readonly Regex DatePattern = new(@"^\d{4}-\d{2}-\d{2}$", RegexOptions.CultureInvariant);

    public static SealedCapsule Seal(SealInput input, EgehanRules rules)
    {
        var spec = rules.Capsule;

        ValidateUnlockDate(input.UnlockDate);
        ValidatePassphrase(input.Passphrase, spec.MinPassphraseLength);

        if (input.Message.Trim().Length == 0) throw new CapsuleException("There is no message to seal.");

        var salt = RandomNumberGenerator.GetBytes(spec.SaltBytes);
        var iv = RandomNumberGenerator.GetBytes(spec.IvBytes);
        var key = DeriveKey(input.Passphrase, salt, rules, spec.Iterations);

        var plaintext = Encoding.UTF8.GetBytes(input.Message);
        var body = new byte[plaintext.Length];
        var tag = new byte[spec.AuthTagBits / 8];

        using (var aes = new AesGcm(key, tag.Length))
        {
            aes.Encrypt(iv, plaintext, body, tag, AdditionalData(input.UnlockDate, rules));
        }

        // Web Crypto expects the authentication tag appended to the ciphertext; .NET hands it over
        // separately. Concatenating here is what lets the browser open what this sealed.
        var ciphertext = new byte[body.Length + tag.Length];
        body.CopyTo(ciphertext, 0);
        tag.CopyTo(ciphertext, body.Length);

        return new SealedCapsule
        {
            UnlockDate = input.UnlockDate,
            AuthorLabel = EmptyToNull(input.AuthorLabel),
            Hint = EmptyToNull(input.Hint),
            Algorithm = new CapsuleAlgorithm { Iterations = spec.Iterations },
            Salt = Convert.ToBase64String(salt),
            Iv = Convert.ToBase64String(iv),
            Ciphertext = Convert.ToBase64String(ciphertext),
            CreatedAt = input.CreatedAt,
        };
    }

    public static string Open(SealedCapsule capsule, string passphrase, EgehanRules rules)
    {
        var tagBytes = rules.Capsule.AuthTagBits / 8;
        var raw = Convert.FromBase64String(capsule.Ciphertext);

        if (raw.Length <= tagBytes) throw new CapsuleException("This capsule is truncated; there is nothing to decrypt.");

        var key = DeriveKey(passphrase, Convert.FromBase64String(capsule.Salt), rules, capsule.Algorithm.Iterations);
        var body = raw.AsSpan(0, raw.Length - tagBytes);
        var tag = raw.AsSpan(raw.Length - tagBytes);
        var plaintext = new byte[body.Length];

        try
        {
            using var aes = new AesGcm(key, tagBytes);
            aes.Decrypt(
                Convert.FromBase64String(capsule.Iv),
                body,
                tag,
                plaintext,
                AdditionalData(capsule.UnlockDate, rules));
        }
        catch (CryptographicException)
        {
            // A wrong passphrase and a tampered file fail identically here, which is the property
            // that makes this worth using. Say the one thing that is true.
            throw new CapsuleException("That passphrase does not open this capsule.");
        }

        return Encoding.UTF8.GetString(plaintext);
    }

    private static byte[] DeriveKey(string passphrase, byte[] salt, EgehanRules rules, int iterations)
        => Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(passphrase.Normalize(NormalizationForm.FormC)),
            salt,
            iterations,
            HashAlgorithmName.SHA256,
            rules.Capsule.DerivedKeyBits / 8);

    /// <summary>
    /// The unlock date, bound into the ciphertext as additional authenticated data.
    /// </summary>
    /// <remarks>
    /// This does not make the date a security control — nothing could, on a file the reader
    /// holds. It makes the date tamper-evident: editing the countdown in a published chronicle
    /// stops the capsule opening, so an altered file announces itself.
    /// </remarks>
    private static byte[] AdditionalData(string unlockDate, EgehanRules rules)
        => Encoding.UTF8.GetBytes(
            rules.Capsule.AdditionalDataFormat.Replace("{unlockDate}", unlockDate, StringComparison.Ordinal));

    private static void ValidateUnlockDate(string value)
    {
        if (!DatePattern.IsMatch(value))
        {
            throw new CapsuleException($"The unlock date must look like YYYY-MM-DD, not \"{value}\".");
        }
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", out _))
        {
            throw new CapsuleException($"\"{value}\" is not a date that exists.");
        }
    }

    private static void ValidatePassphrase(string passphrase, int minimum)
    {
        var length = new System.Globalization.StringInfo(passphrase).LengthInTextElements;
        if (length < minimum)
        {
            throw new CapsuleException(
                $"The passphrase must be at least {minimum} characters. This is the only thing standing " +
                "between the message and anyone who opens the file, and it cannot be reset or recovered.");
        }
    }

    /// <summary>Constant-time comparison for the confirmation prompt.</summary>
    public static bool PassphrasesMatch(string first, string second)
    {
        var a = Encoding.UTF8.GetBytes(first.Normalize(NormalizationForm.FormC));
        var b = Encoding.UTF8.GetBytes(second.Normalize(NormalizationForm.FormC));
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    private static string? EmptyToNull(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
