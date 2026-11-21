using System.Text.Json.Serialization;

namespace Egehan.Core.Model;

/// <summary>
/// The C# mirror of <c>core-spec/schema/egehan-report.schema.json</c>.
/// </summary>
/// <remarks>
/// These records are a convenience for this engine, not the specification — the schema is, and
/// where the two disagree the schema wins. Property declaration order is the serialization order,
/// so it follows the schema's order to keep a generated report readable beside the Node one.
/// </remarks>
public sealed record ChangedFile(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("insertions")] int Insertions,
    [property: JsonPropertyName("deletions")] int Deletions);

/// <summary>
/// A commit after the git-reading layer has normalised it.
/// </summary>
/// <remarks>
/// This is the documented boundary of the system: everything above it is platform-specific
/// plumbing, everything below must behave identically in every runtime. The conformance fixtures
/// in core-spec are expressed in exactly this shape.
/// </remarks>
public sealed record NormalizedCommit
{
    [JsonPropertyName("sha")] public required string Sha { get; init; }
    [JsonPropertyName("parents")] public IReadOnlyList<string> Parents { get; init; } = [];
    [JsonPropertyName("authorName")] public required string AuthorName { get; init; }
    [JsonPropertyName("authorEmail")] public required string AuthorEmail { get; init; }

    /// <summary>ISO-8601 with the commit's own UTC offset preserved. The offset is load-bearing.</summary>
    [JsonPropertyName("authoredAt")] public required string AuthoredAt { get; init; }

    [JsonPropertyName("committedAt")] public required string CommittedAt { get; init; }
    [JsonPropertyName("subject")] public required string Subject { get; init; }
    [JsonPropertyName("body")] public string Body { get; init; } = "";
    [JsonPropertyName("tags")] public IReadOnlyList<string> Tags { get; init; } = [];
    [JsonPropertyName("files")] public IReadOnlyList<ChangedFile> Files { get; init; } = [];
}

public sealed record GeneratorInfo
{
    [JsonPropertyName("name")] public string Name { get; init; } = "egehan";
    [JsonPropertyName("version")] public required string Version { get; init; }
    [JsonPropertyName("platform")] public string Platform { get; init; } = "dotnet";
    [JsonPropertyName("specVersion")] public required string SpecVersion { get; init; }
    [JsonPropertyName("dictionaryVersion")] public required string DictionaryVersion { get; init; }

    /// <summary>The only field allowed to depend on wall-clock time.</summary>
    [JsonPropertyName("generatedAt")] public required string GeneratedAt { get; init; }
}

public sealed record ProjectInfo
{
    [JsonPropertyName("name")] public required string Name { get; init; }
    [JsonPropertyName("dedication")] public string? Dedication { get; init; }
    [JsonPropertyName("detectedTypes")] public IReadOnlyList<string> DetectedTypes { get; init; } = [];
    [JsonPropertyName("flavor")] public required string Flavor { get; init; }
    [JsonPropertyName("defaultBranch")] public string? DefaultBranch { get; init; }
    [JsonPropertyName("remoteHost")] public string? RemoteHost { get; init; }
}

public sealed record ReportConfig
{
    [JsonPropertyName("language")] public required string Language { get; init; }
    [JsonPropertyName("tone")] public required string Tone { get; init; }
    [JsonPropertyName("redactEmails")] public bool RedactEmails { get; init; } = true;
    [JsonPropertyName("anonymizeAuthors")] public bool AnonymizeAuthors { get; init; }
    [JsonPropertyName("includeMergeCommits")] public bool IncludeMergeCommits { get; init; }
    [JsonPropertyName("theme")] public string Theme { get; init; } = "auto";
}

public sealed record RangeInfo
{
    [JsonPropertyName("since")] public string? Since { get; init; }
    [JsonPropertyName("until")] public string? Until { get; init; }
    [JsonPropertyName("firstCommitAt")] public required string FirstCommitAt { get; init; }
    [JsonPropertyName("lastCommitAt")] public required string LastCommitAt { get; init; }
    [JsonPropertyName("days")] public int Days { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
}

public sealed record Totals
{
    [JsonPropertyName("commits")] public int Commits { get; init; }
    [JsonPropertyName("authors")] public int Authors { get; init; }
    [JsonPropertyName("insertions")] public int Insertions { get; init; }
    [JsonPropertyName("deletions")] public int Deletions { get; init; }
    [JsonPropertyName("filesTouched")] public int FilesTouched { get; init; }
    [JsonPropertyName("tags")] public int Tags { get; init; }
    [JsonPropertyName("mergeCommits")] public int MergeCommits { get; init; }
    [JsonPropertyName("byCategory")] public IReadOnlyDictionary<string, int> ByCategory { get; init; } = new Dictionary<string, int>();
    [JsonPropertyName("byType")] public IReadOnlyDictionary<string, int> ByType { get; init; } = new Dictionary<string, int>();
}

public sealed record AuthorSummary
{
    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("displayName")] public required string DisplayName { get; init; }
    [JsonPropertyName("emailHash")] public string? EmailHash { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("commits")] public int Commits { get; init; }
    [JsonPropertyName("insertions")] public int Insertions { get; init; }
    [JsonPropertyName("deletions")] public int Deletions { get; init; }
    [JsonPropertyName("firstCommitAt")] public required string FirstCommitAt { get; init; }
    [JsonPropertyName("lastCommitAt")] public required string LastCommitAt { get; init; }
}

public sealed record ConventionalInfo
{
    [JsonPropertyName("type")] public required string Type { get; init; }
    [JsonPropertyName("scope")] public string? Scope { get; init; }
    [JsonPropertyName("breaking")] public bool Breaking { get; init; }

    /// <summary>True when the type came from keyword fallback rather than an explicit prefix.</summary>
    [JsonPropertyName("inferred")] public bool Inferred { get; init; }
}

public sealed record EntryStats
{
    [JsonPropertyName("filesCount")] public int FilesCount { get; init; }
    [JsonPropertyName("insertions")] public int Insertions { get; init; }
    [JsonPropertyName("deletions")] public int Deletions { get; init; }
    [JsonPropertyName("sizeBucket")] public required string SizeBucket { get; init; }
}

public sealed record ReportEntry
{
    [JsonPropertyName("sha")] public required string Sha { get; init; }
    [JsonPropertyName("shortSha")] public required string ShortSha { get; init; }
    [JsonPropertyName("parents")] public IReadOnlyList<string> Parents { get; init; } = [];
    [JsonPropertyName("authorId")] public required string AuthorId { get; init; }
    [JsonPropertyName("authoredAt")] public required string AuthoredAt { get; init; }
    [JsonPropertyName("committedAt")] public required string CommittedAt { get; init; }
    [JsonPropertyName("tzOffsetMinutes")] public int TzOffsetMinutes { get; init; }
    [JsonPropertyName("localHour")] public int LocalHour { get; init; }

    /// <summary>0 = Monday, per rules.json → time.weekStartsOn.</summary>
    [JsonPropertyName("localWeekday")] public int LocalWeekday { get; init; }

    [JsonPropertyName("subject")] public required string Subject { get; init; }
    [JsonPropertyName("cleanSubject")] public required string CleanSubject { get; init; }
    [JsonPropertyName("conventional")] public required ConventionalInfo Conventional { get; init; }
    [JsonPropertyName("tags")] public IReadOnlyList<string> Tags { get; init; } = [];
    [JsonPropertyName("stats")] public required EntryStats Stats { get; init; }
    [JsonPropertyName("category")] public required string Category { get; init; }
    [JsonPropertyName("secondaryCategories")] public IReadOnlyList<string> SecondaryCategories { get; init; } = [];
    [JsonPropertyName("narrative")] public required string Narrative { get; init; }
    [JsonPropertyName("isMerge")] public bool IsMerge { get; init; }
    [JsonPropertyName("variantIndex")] public int VariantIndex { get; init; }
}

public sealed record ChapterStats
{
    [JsonPropertyName("commits")] public int Commits { get; init; }
    [JsonPropertyName("insertions")] public int Insertions { get; init; }
    [JsonPropertyName("deletions")] public int Deletions { get; init; }
    [JsonPropertyName("filesCount")] public int FilesCount { get; init; }
    [JsonPropertyName("authorIds")] public IReadOnlyList<string> AuthorIds { get; init; } = [];
}

public sealed record ReportChapter
{
    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("category")] public required string Category { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("narrative")] public required string Narrative { get; init; }
    [JsonPropertyName("from")] public required string From { get; init; }
    [JsonPropertyName("to")] public required string To { get; init; }
    [JsonPropertyName("entryShas")] public IReadOnlyList<string> EntryShas { get; init; } = [];
    [JsonPropertyName("stats")] public required ChapterStats Stats { get; init; }
}

public sealed record Streak
{
    [JsonPropertyName("days")] public int Days { get; init; }
    [JsonPropertyName("from")] public string? From { get; init; }
    [JsonPropertyName("to")] public string? To { get; init; }
}

public sealed record MonthlyActivity
{
    [JsonPropertyName("month")] public required string Month { get; init; }
    [JsonPropertyName("commits")] public int Commits { get; init; }
    [JsonPropertyName("insertions")] public int Insertions { get; init; }
    [JsonPropertyName("deletions")] public int Deletions { get; init; }
}

public sealed record Pulse
{
    [JsonPropertyName("chronotype")] public required string Chronotype { get; init; }
    [JsonPropertyName("chronotypeLabel")] public required string ChronotypeLabel { get; init; }
    [JsonPropertyName("hourHistogram")] public IReadOnlyList<int> HourHistogram { get; init; } = [];
    [JsonPropertyName("weekdayHistogram")] public IReadOnlyList<int> WeekdayHistogram { get; init; } = [];
    [JsonPropertyName("busiestHour")] public int BusiestHour { get; init; }
    [JsonPropertyName("busiestWeekday")] public int BusiestWeekday { get; init; }
    [JsonPropertyName("creationRatio")] public double CreationRatio { get; init; }
    [JsonPropertyName("avgChangedLines")] public double AvgChangedLines { get; init; }
    [JsonPropertyName("medianChangedLines")] public double MedianChangedLines { get; init; }
    [JsonPropertyName("longestStreak")] public required Streak LongestStreak { get; init; }
    [JsonPropertyName("currentStreak")] public required Streak CurrentStreak { get; init; }
    [JsonPropertyName("monthlyActivity")] public IReadOnlyList<MonthlyActivity> MonthlyActivity { get; init; } = [];
    [JsonPropertyName("narrative")] public required string Narrative { get; init; }
}

public sealed record Milestone
{
    [JsonPropertyName("kind")] public required string Kind { get; init; }
    [JsonPropertyName("at")] public required string At { get; init; }
    [JsonPropertyName("label")] public required string Label { get; init; }
    [JsonPropertyName("value")] public object? Value { get; init; }
    [JsonPropertyName("sha")] public string? Sha { get; init; }
    [JsonPropertyName("narrative")] public required string Narrative { get; init; }
}

public sealed record CapsuleAlgorithm
{
    [JsonPropertyName("kdf")] public string Kdf { get; init; } = "PBKDF2";
    [JsonPropertyName("kdfHash")] public string KdfHash { get; init; } = "SHA-256";
    [JsonPropertyName("iterations")] public int Iterations { get; init; }
    [JsonPropertyName("cipher")] public string Cipher { get; init; } = "AES-256-GCM";
}

public sealed record SealedCapsule
{
    [JsonPropertyName("mode")] public string Mode { get; init; } = "sealed";
    [JsonPropertyName("unlockDate")] public required string UnlockDate { get; init; }
    [JsonPropertyName("authorLabel")] public string? AuthorLabel { get; init; }
    [JsonPropertyName("hint")] public string? Hint { get; init; }
    [JsonPropertyName("algorithm")] public required CapsuleAlgorithm Algorithm { get; init; }
    [JsonPropertyName("salt")] public required string Salt { get; init; }
    [JsonPropertyName("iv")] public required string Iv { get; init; }
    [JsonPropertyName("ciphertext")] public required string Ciphertext { get; init; }
    [JsonPropertyName("createdAt")] public required string CreatedAt { get; init; }
}

public sealed record EgehanReport
{
    [JsonPropertyName("schemaVersion")] public required string SchemaVersion { get; init; }
    [JsonPropertyName("generator")] public required GeneratorInfo Generator { get; init; }
    [JsonPropertyName("project")] public required ProjectInfo Project { get; init; }
    [JsonPropertyName("config")] public required ReportConfig Config { get; init; }
    [JsonPropertyName("range")] public required RangeInfo Range { get; init; }
    [JsonPropertyName("totals")] public required Totals Totals { get; init; }
    [JsonPropertyName("authors")] public IReadOnlyList<AuthorSummary> Authors { get; init; } = [];
    [JsonPropertyName("chapters")] public IReadOnlyList<ReportChapter> Chapters { get; init; } = [];
    [JsonPropertyName("entries")] public IReadOnlyList<ReportEntry> Entries { get; init; } = [];
    [JsonPropertyName("pulse")] public required Pulse Pulse { get; init; }
    [JsonPropertyName("milestones")] public IReadOnlyList<Milestone> Milestones { get; init; } = [];
    [JsonPropertyName("capsule")] public SealedCapsule? Capsule { get; init; }
}
