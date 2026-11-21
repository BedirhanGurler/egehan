using System.Text.Json;
using System.Text.Json.Serialization;

namespace Egehan.Core.Spec;

/// <summary>
/// The typed view of <c>core-spec/spec/rules.json</c> — the engine contract.
/// </summary>
/// <remarks>
/// Nothing in this engine may hard-code a threshold that lives here. A magic number in engine
/// code is a number the Node implementation cannot see, and the moment the two disagree the
/// project's correctness claim collapses.
/// </remarks>
public sealed record DeterminismRules
{
    public int HashPrefixLength { get; init; } = 8;
    public int HashRadix { get; init; } = 16;
    public string SelectionFormula { get; init; } = "";
}

public sealed record GitRules
{
    public IReadOnlyList<string> MandatoryFlags { get; init; } = [];
    public string RecordSeparator { get; init; } = "\u001e";
    public string FieldSeparator { get; init; } = "\u001f";
    public IReadOnlyList<string> LogFields { get; init; } = [];
    public string TagSource { get; init; } = "for-each-ref";
    public IReadOnlyList<string> CommitOrdering { get; init; } = [];
    public int MaxSubjectLength { get; init; } = 200;
}

public sealed record TimeRules
{
    public string Mode { get; init; } = "author-local";
    public int WeekStartsOn { get; init; } = 1;
}

public sealed record SubjectCleanupRules
{
    public string StripPrefixPattern { get; init; } = "";
    public string StripTicketPattern { get; init; } = "";
    public bool StripTrailingPeriod { get; init; } = true;
    public bool CollapseWhitespace { get; init; } = true;
    public bool CapitalizeFirstLetter { get; init; }
    public string CapitalizationLocale { get; init; } = "report-language";
    public int MaxLength { get; init; } = 140;
    public string Ellipsis { get; init; } = "…";
}

public sealed record ConventionalRules
{
    public string Pattern { get; init; } = "";
    public string RevertPattern { get; init; } = "";
    public string MergePattern { get; init; } = "";
    public IReadOnlyDictionary<string, string> TypeAliases { get; init; } = new Dictionary<string, string>();

    /// <summary>
    /// Raw because the JSON object carries a <c>$comment</c> key alongside the keyword lists;
    /// deserialising straight into a dictionary of arrays would fail on it.
    /// </summary>
    [JsonPropertyName("keywordFallback")]
    public JsonElement KeywordFallbackRaw { get; init; }

    public IReadOnlyList<string> KeywordFallbackOrder { get; init; } = [];
    public SubjectCleanupRules SubjectCleanup { get; init; } = new();

    public IReadOnlyDictionary<string, IReadOnlyList<string>> KeywordFallback()
    {
        var result = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        if (KeywordFallbackRaw.ValueKind != JsonValueKind.Object) return result;

        foreach (var property in KeywordFallbackRaw.EnumerateObject())
        {
            if (property.Name.StartsWith('$') || property.Value.ValueKind != JsonValueKind.Array) continue;
            result[property.Name] = property.Value.EnumerateArray().Select(item => item.GetString() ?? "").ToList();
        }

        return result;
    }
}

public sealed record NarrativeRules
{
    public bool CapitalizeFirstLetter { get; init; } = true;
    public string CapitalizationLocale { get; init; } = "report-language";
    public bool SkipWhenFirstCharIsNotALetter { get; init; } = true;
}

public sealed record CategoryRules
{
    public string Description { get; init; } = "";
    public bool? FirstCommitAlwaysMatches { get; init; }
    public double? SetupWindowHours { get; init; }
    public IReadOnlyList<string>? SetupWindowAppliesToTypes { get; init; }
    public bool? RequiresNoReleaseTagBefore { get; init; }
    public IReadOnlyList<string>? Types { get; init; }
    public double? ClusterWindowHours { get; init; }
    public int? MinFixCommitsInCluster { get; init; }
    public IReadOnlyList<string>? ClusterFixTypes { get; init; }
    public double? RefactorDeletionRatio { get; init; }
    public int? RefactorMinChangedLines { get; init; }
    public int? LocalHourFrom { get; init; }
    public int? LocalHourTo { get; init; }
    public string? TagPattern { get; init; }
    public int? LargeInsertionThreshold { get; init; }
    public bool? BreakingChangeMatches { get; init; }
    public bool? IsFallback { get; init; }
}

public sealed record ClassificationRules
{
    public IReadOnlyList<string> EvaluationOrder { get; init; } = [];
    public IReadOnlyDictionary<string, CategoryRules> Categories { get; init; } = new Dictionary<string, CategoryRules>();
    public IReadOnlyList<string> ModifierCategories { get; init; } = [];
    public int MaxModifiersPerEntry { get; init; } = 1;
}

public sealed record ChapterRules
{
    public string GroupBy { get; init; } = "";
    public int MaxEntriesPerChapter { get; init; } = 40;
    public double MaxGapHoursWithinChapter { get; init; } = 720;
}

public sealed record ChronotypeRule
{
    public string Id { get; init; } = "";
    public IReadOnlyList<int> Hours { get; init; } = [];
    public double MinShare { get; init; }
}

public sealed record SizeBucketRule
{
    public string Id { get; init; } = "";
    public int? MaxChangedLines { get; init; }
}

public sealed record StreakRules
{
    public string Unit { get; init; } = "local-calendar-day";
    public int MinLengthToReport { get; init; } = 2;
    public string Anchor { get; init; } = "last-commit-in-range";
}

public sealed record RoundingRules
{
    public int RatioDecimals { get; init; } = 4;
    public int AverageDecimals { get; init; } = 2;
}

public sealed record PulseRules
{
    public IReadOnlyList<ChronotypeRule> Chronotypes { get; init; } = [];
    public string FallbackChronotype { get; init; } = "balanced-rhythm";
    public string CreationRatioFormula { get; init; } = "";
    public int PeakSmoothingWindow { get; init; } = 1;
    public StreakRules Streak { get; init; } = new();
    public RoundingRules Rounding { get; init; } = new();
    public IReadOnlyList<SizeBucketRule> SizeBuckets { get; init; } = [];
}

public sealed record MilestoneCelebrationRules
{
    public IReadOnlyList<int> CommitCounts { get; init; } = [];
    public IReadOnlyList<int> AnniversaryDays { get; init; } = [];
    public bool OnReleaseTag { get; init; } = true;
    public bool OnMidnightFix { get; init; } = true;
    public string MidnightFixMilestone { get; init; } = "first-only";
    public IReadOnlyList<int> OnStreakDays { get; init; } = [];
}

public sealed record ProjectTypeDetector
{
    public string Id { get; init; } = "";
    public string Flavor { get; init; } = "";
    public int Priority { get; init; }
    public IReadOnlyList<string>? AnyFile { get; init; }
    public IReadOnlyList<string>? AnyGlob { get; init; }
    public IReadOnlyList<string>? AllDirs { get; init; }
}

public sealed record ProjectTypeRules
{
    public IReadOnlyList<ProjectTypeDetector> Detectors { get; init; } = [];
    public string FallbackFlavor { get; init; } = "library";
    public int MaxDepth { get; init; } = 2;
    public IReadOnlyList<string> IgnoreDirs { get; init; } = [];
}

public sealed record PrivacyRules
{
    public bool RedactEmailsByDefault { get; init; } = true;
    public string EmailHashAlgorithm { get; init; } = "sha256";
    public int EmailHashPrefixLength { get; init; } = 12;
    public string AnonymizeAuthorFormat { get; init; } = "";
    public string AnonymizeAuthorFormatEn { get; init; } = "";
    public string EmailPattern { get; init; } = "";
}

public sealed record CapsuleRules
{
    public string Mode { get; init; } = "sealed";
    public string Kdf { get; init; } = "PBKDF2";
    public string KdfHash { get; init; } = "SHA-256";
    public int Iterations { get; init; } = 600000;
    public int DerivedKeyBits { get; init; } = 256;
    public string Cipher { get; init; } = "AES-256-GCM";
    public int SaltBytes { get; init; } = 16;
    public int IvBytes { get; init; } = 12;
    public int AuthTagBits { get; init; } = 128;
    public string Encoding { get; init; } = "base64";
    public string AdditionalDataFormat { get; init; } = "";
    public int MinPassphraseLength { get; init; } = 12;
    public bool TrackedByGitByDefault { get; init; }
}

public sealed record OutputRules
{
    public bool EmbedGenerationTimeInArtifacts { get; init; }
    public string MarkdownFileName { get; init; } = "EGEHAN.md";
    public string HtmlFileName { get; init; } = "egehan-chronicle.html";
    public string ReportFileName { get; init; } = "egehan-report.json";
    public string CapsuleFileName { get; init; } = "capsule.egehan.json";
    public string StateDirName { get; init; } = ".egehan";
    public string ConfigFileName { get; init; } = ".egehanrc.json";
}

public sealed record LimitRules
{
    public int MaxCommitsPerRun { get; init; } = 100000;
    public int MaxEntriesInHtml { get; init; } = 5000;
    public int WarnAboveCommits { get; init; } = 20000;
}

public sealed record EgehanRules
{
    public string SpecVersion { get; init; } = "";
    public string SchemaVersion { get; init; } = "";
    public DeterminismRules Determinism { get; init; } = new();
    public GitRules Git { get; init; } = new();
    public TimeRules Time { get; init; } = new();
    public ConventionalRules ConventionalCommits { get; init; } = new();
    public NarrativeRules Narrative { get; init; } = new();
    public ClassificationRules Classification { get; init; } = new();
    public ChapterRules Chapters { get; init; } = new();
    public PulseRules Pulse { get; init; } = new();
    public MilestoneCelebrationRules MilestoneCelebrations { get; init; } = new();
    public ProjectTypeRules ProjectTypes { get; init; } = new();
    public PrivacyRules Privacy { get; init; } = new();
    public CapsuleRules Capsule { get; init; } = new();
    public OutputRules Output { get; init; } = new();
    public LimitRules Limits { get; init; } = new();

    private static EgehanRules? cached;

    public static JsonSerializerOptions ReadOptions { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        ReadCommentHandling = JsonCommentHandling.Skip,
    };

    public static EgehanRules Load()
        => cached ??= JsonSerializer.Deserialize<EgehanRules>(EmbeddedAssets.ReadRules(), ReadOptions)
            ?? throw new InvalidOperationException("spec/rules.json could not be read.");

    public CategoryRules RequireCategory(string category)
        => Categories(category) ?? throw new InvalidOperationException(
            $"spec/rules.json declares no classification rules for category \"{category}\".");

    public CategoryRules? Categories(string category)
        => Classification.Categories.TryGetValue(category, out var rules) ? rules : null;
}
