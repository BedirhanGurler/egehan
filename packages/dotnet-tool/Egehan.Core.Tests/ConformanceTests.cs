using System.Text.Json;
using System.Text.Json.Nodes;
using Egehan.Core.Engine;
using Egehan.Core.Model;
using Egehan.Core.Spec;
using Xunit;

namespace Egehan.Core.Tests;

/// <summary>
/// The conformance suite: this engine against the reports the Node engine produced.
/// </summary>
/// <remarks>
/// This is the project's central correctness claim. Two implementations of one contract are only
/// worth having if "they agree" is a thing CI can prove, and the expected files in
/// <c>packages/core-spec/fixtures</c> are the proof. Any difference here is a bug in one of the
/// two engines, whichever one moved.
///
/// Two fields are excluded, and only two: <c>generator.platform</c>, which is the one value the
/// engines are *supposed* to disagree about, and <c>generator.generatedAt</c>, the only field
/// allowed to depend on when the report was made.
/// </remarks>
public sealed class ConformanceTests
{
    private const string GeneratedAt = "2026-01-01T00:00:00+00:00";
    private const string Version = "0.0.0-fixture";

    private static readonly HashSet<string> Ignored = new(StringComparer.Ordinal)
    {
        ".generator.platform",
        ".generator.generatedAt",
    };

    public static TheoryData<string, string, string> Cases()
    {
        var data = new TheoryData<string, string, string>();

        foreach (var fixture in Fixtures.Names())
        {
            foreach (var language in new[] { "tr", "en" })
            {
                foreach (var tone in new[] { "poetic", "minimalist", "humorous" })
                {
                    data.Add(fixture, language, tone);
                }
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Reproduces_the_report_the_node_engine_produced(string fixture, string language, string tone)
    {
        var directory = Path.Combine(Fixtures.Directory(), fixture);
        var input = Fixtures.Read(Path.Combine(directory, "input.json")).AsObject();

        var expectedPath = Path.Combine(directory, $"expected.{language}.{tone}.json");
        Assert.True(File.Exists(expectedPath), $"The expected report {expectedPath} is missing.");

        var report = BuildFrom(input, language, tone);
        var actual = JsonNode.Parse(JsonSerializer.Serialize(report, Fixtures.WriteOptions))!;
        var expected = Fixtures.Read(expectedPath);

        var difference = Fixtures.FirstDifference(expected, actual, Ignored);

        Assert.True(
            difference is null,
            $"{fixture} ({language}/{tone}) diverges from the Node engine at {difference}");
    }

    [Fact]
    public void Declares_itself_as_the_dotnet_engine()
    {
        var fixture = Fixtures.Names().First();
        var input = Fixtures.Read(Path.Combine(Fixtures.Directory(), fixture, "input.json")).AsObject();

        var report = BuildFrom(input, "tr", "poetic");

        Assert.Equal("dotnet", report.Generator.Platform);
        Assert.Equal("egehan", report.Generator.Name);
        Assert.Equal(EgehanRules.Load().SpecVersion, report.Generator.SpecVersion);
    }

    [Fact]
    public void Narration_is_stable_across_runs()
    {
        var fixture = Fixtures.Names().First();
        var input = Fixtures.Read(Path.Combine(Fixtures.Directory(), fixture, "input.json")).AsObject();

        var first = JsonSerializer.Serialize(BuildFrom(input, "tr", "poetic"), Fixtures.WriteOptions);
        var second = JsonSerializer.Serialize(BuildFrom(input, "tr", "poetic"), Fixtures.WriteOptions);

        Assert.Equal(first, second);
    }

    [Fact]
    public void Both_dictionaries_are_embedded_and_loadable()
    {
        var languages = EmbeddedAssets.AvailableLanguages();

        Assert.Contains("tr", languages);
        Assert.Contains("en", languages);

        foreach (var language in languages)
        {
            var dictionary = NarrativeDictionary.Load(language);
            Assert.Equal(language, dictionary.Language);
            Assert.NotEmpty(dictionary.Categories);
            Assert.Equal(12, dictionary.Locale.Months.Count);
        }
    }

    private static EgehanReport BuildFrom(JsonObject input, string language, string tone)
    {
        var project = input["project"]!.AsObject();
        var config = input["config"]!.AsObject();

        var commits = input["commits"]!.AsArray()
            .Select(node =>
            {
                var commit = node!.AsObject();
                return new NormalizedCommit
                {
                    Sha = commit["sha"]!.GetValue<string>(),
                    Parents = commit["parents"]!.AsArray().Select(item => item!.GetValue<string>()).ToList(),
                    AuthorName = commit["authorName"]!.GetValue<string>(),
                    AuthorEmail = commit["authorEmail"]!.GetValue<string>(),
                    AuthoredAt = commit["authoredAt"]!.GetValue<string>(),
                    CommittedAt = commit["committedAt"]!.GetValue<string>(),
                    Subject = commit["subject"]!.GetValue<string>(),
                    Body = commit["body"]?.GetValue<string>() ?? "",
                    Tags = commit["tags"]?.AsArray().Select(item => item!.GetValue<string>()).ToList() ?? [],
                    Files = commit["files"]!.AsArray()
                        .Select(item => new ChangedFile(
                            item!["path"]!.GetValue<string>(),
                            item["insertions"]!.GetValue<int>(),
                            item["deletions"]!.GetValue<int>()))
                        .ToList(),
                };
            })
            .ToList();

        return ReportBuilder.Build(new BuildReportInput
        {
            Commits = commits,
            Project = new ProjectInfo
            {
                Name = project["name"]!.GetValue<string>(),
                Dedication = null,
                DetectedTypes = project["detectedTypes"]!.AsArray().Select(item => item!.GetValue<string>()).ToList(),
                Flavor = project["flavor"]!.GetValue<string>(),
                DefaultBranch = project["defaultBranch"]?.GetValue<string>(),
                RemoteHost = project["remoteHost"]?.GetValue<string>(),
            },
            Config = new ReportConfig
            {
                Language = language,
                Tone = tone,
                RedactEmails = config["redactEmails"]!.GetValue<bool>(),
                AnonymizeAuthors = config["anonymizeAuthors"]!.GetValue<bool>(),
                IncludeMergeCommits = config["includeMergeCommits"]?.GetValue<bool>() ?? false,
                Theme = config["theme"]?.GetValue<string>() ?? "auto",
            },
            Since = null,
            Until = null,
            Truncated = false,
            GeneratorVersion = Version,
            GeneratedAt = GeneratedAt,
        });
    }
}

/// <summary>
/// A handful of sentences pinned verbatim.
/// </summary>
/// <remarks>
/// The structural comparison above proves the two engines agree; these prove the agreement is on
/// something worth reading. If the dictionaries change, these move — and seeing them move in a
/// diff is the point.
/// </remarks>
public sealed class NarrationTests
{
    [Fact]
    public void The_worked_example_reads_the_way_the_specification_promised()
    {
        var directory = Path.Combine(Fixtures.Directory(), "01-frontend-saas");
        var expected = Fixtures.Read(Path.Combine(directory, "expected.tr.poetic.json")).AsObject();

        var entry = expected["entries"]!.AsArray()
            .Select(node => node!.AsObject())
            .Single(node => node["subject"]!.GetValue<string>() == "fix: token refresh race condition");

        Assert.Equal("midnight-oil", entry["category"]!.GetValue<string>());
        Assert.Equal(3, entry["localHour"]!.GetValue<int>());
        Assert.Equal(180, entry["tzOffsetMinutes"]!.GetValue<int>());
        Assert.Contains("03:18", entry["narrative"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Contains("herkes uyurken", entry["narrative"]!.GetValue<string>(), StringComparison.Ordinal);
    }
}
