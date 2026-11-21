using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Egehan.Core.Model;
using Egehan.Core.Spec;

namespace Egehan.Core.Engine;

/// <summary>
/// Author identity and redaction.
/// </summary>
/// <remarks>
/// This engine reads <c>git log</c>, which carries every contributor's e-mail address, and feeds
/// a file whose purpose is to be shared. Redaction is on by default so that running the tool on a
/// work repository never hands somebody a file that leaks their team's addresses. The hash stays
/// because identity merging needs a stable key, and a truncated digest is a stable key that is
/// not an address.
/// </remarks>
public sealed record AuthorIdentity(string Id, string Key, string DisplayName, string? EmailHash, string? Email);

public sealed record PrivacyOptions(bool RedactEmails, bool AnonymizeAuthors, string Language);

public static class Privacy
{
    public static string HashEmail(string email, EgehanRules rules)
    {
        var digest = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant())))
            .ToLowerInvariant();

        return digest[..rules.Privacy.EmailHashPrefixLength];
    }

    private sealed class Accumulator
    {
        public required string Key { get; init; }
        public string LatestName { get; set; } = "";
        public long LatestAt { get; set; }
        public string Email { get; init; } = "";
        public int Commits { get; set; }
        public int Insertions { get; set; }
        public int Deletions { get; set; }
        public string FirstCommitAt { get; init; } = "";
        public string LastCommitAt { get; set; } = "";
        public int FirstSeenIndex { get; init; }
    }

    public sealed record AuthorIndex(
        IReadOnlyList<AuthorSummary> Authors,
        IReadOnlyDictionary<string, AuthorIdentity> ByKey)
    {
        public AuthorIdentity Of(NormalizedCommit commit)
            => ByKey.TryGetValue(IdentityKey(commit), out var identity)
                ? identity
                : throw new InvalidOperationException($"No author identity was built for commit {commit.Sha}.");
    }

    public static AuthorIndex BuildAuthors(
        IReadOnlyList<NormalizedCommit> commits,
        EgehanRules rules,
        PrivacyOptions options)
    {
        var accumulators = new Dictionary<string, Accumulator>(StringComparer.Ordinal);

        for (var index = 0; index < commits.Count; index += 1)
        {
            var commit = commits[index];
            var key = IdentityKey(commit);
            var insertions = commit.Files.Sum(file => file.Insertions);
            var deletions = commit.Files.Sum(file => file.Deletions);
            var at = Timestamps.Parse(commit.AuthoredAt).EpochMs;

            if (!accumulators.TryGetValue(key, out var existing))
            {
                accumulators[key] = new Accumulator
                {
                    Key = key,
                    LatestName = commit.AuthorName.Trim(),
                    LatestAt = at,
                    Email = commit.AuthorEmail.Trim(),
                    Commits = 1,
                    Insertions = insertions,
                    Deletions = deletions,
                    FirstCommitAt = commit.AuthoredAt,
                    LastCommitAt = commit.AuthoredAt,
                    FirstSeenIndex = index,
                };
                continue;
            }

            existing.Commits += 1;
            existing.Insertions += insertions;
            existing.Deletions += deletions;
            existing.LastCommitAt = commit.AuthoredAt;

            // The display name comes from the author's most recent commit: people correct the
            // spelling of their own name years into a project, and the chronicle should show the
            // corrected one.
            if (at >= existing.LatestAt)
            {
                existing.LatestAt = at;
                if (commit.AuthorName.Trim().Length > 0) existing.LatestName = commit.AuthorName.Trim();
            }
        }

        // A total order, declared: most commits first, then earliest appearance. Without the
        // tie-break the two engines could emit the same authors in a different sequence.
        var ordered = accumulators.Values
            .OrderByDescending(accumulator => accumulator.Commits)
            .ThenBy(accumulator => accumulator.FirstSeenIndex)
            .ToList();

        var identities = new Dictionary<string, AuthorIdentity>(StringComparer.Ordinal);
        var authors = new List<AuthorSummary>(ordered.Count);

        for (var position = 0; position < ordered.Count; position += 1)
        {
            var accumulator = ordered[position];
            var emailHash = accumulator.Email.Length == 0 ? null : HashEmail(accumulator.Email, rules);

            var identity = new AuthorIdentity(
                Id: emailHash is null ? $"author-{Slug(accumulator.Key)}" : $"author-{emailHash}",
                Key: accumulator.Key,
                DisplayName: options.AnonymizeAuthors
                    ? AnonymousName(position + 1, rules, options.Language)
                    : (accumulator.LatestName.Length > 0 ? accumulator.LatestName : accumulator.Key),
                EmailHash: emailHash,
                Email: options.RedactEmails || options.AnonymizeAuthors
                    ? null
                    : (accumulator.Email.Length == 0 ? null : accumulator.Email));

            identities[accumulator.Key] = identity;

            authors.Add(new AuthorSummary
            {
                Id = identity.Id,
                DisplayName = identity.DisplayName,
                EmailHash = identity.EmailHash,
                Email = identity.Email,
                Commits = accumulator.Commits,
                Insertions = accumulator.Insertions,
                Deletions = accumulator.Deletions,
                FirstCommitAt = accumulator.FirstCommitAt,
                LastCommitAt = accumulator.LastCommitAt,
            });
        }

        return new AuthorIndex(authors, identities);
    }

    private static string IdentityKey(NormalizedCommit commit)
    {
        var email = commit.AuthorEmail.Trim().ToLowerInvariant();
        return email.Length > 0 ? email : $"name:{commit.AuthorName.Trim().ToLowerInvariant()}";
    }

    private static string AnonymousName(int index, EgehanRules rules, string language)
    {
        var template = language == "tr"
            ? rules.Privacy.AnonymizeAuthorFormat
            : rules.Privacy.AnonymizeAuthorFormatEn;

        return template.Replace("{index}", index.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }

    private static string Slug(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..12];

    /// <summary>
    /// Removes e-mail addresses from free text.
    /// </summary>
    /// <remarks>
    /// Commit subjects do contain addresses — "fix: drop hardcoded admin@example.com" is a real
    /// commit somebody has written — and the subject is reproduced verbatim in the chronicle.
    /// Redacting the author field while publishing the subject untouched would be a redaction in
    /// name only.
    /// </remarks>
    public static string RedactEmailsIn(string text, EgehanRules rules)
        => Regex.Replace(text, rules.Privacy.EmailPattern, "[redacted]");
}
