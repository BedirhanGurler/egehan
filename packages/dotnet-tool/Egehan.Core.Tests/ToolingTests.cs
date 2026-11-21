using System.Diagnostics;
using System.Text.Json.Nodes;
using Egehan.Core;
using Egehan.Core.Config;
using Egehan.Core.Detect;
using Egehan.Core.Git;
using Egehan.Core.Hooks;
using Egehan.Core.Render;
using Egehan.Core.Spec;
using Xunit;

namespace Egehan.Core.Tests;

/// <summary>Hooks: mostly tests that Egehan does <em>not</em> do something.</summary>
public sealed class HookTests
{
    private const string Version = "9.9.9-test";

    [Fact]
    public void The_script_comes_from_the_shared_contract_and_differs_only_by_verb()
    {
        var commit = HookBlock.Build("post-commit", Version);
        var merge = HookBlock.Build("post-merge", Version);

        Assert.Contains(HookBlock.BeginMarker, commit, StringComparison.Ordinal);
        Assert.Contains(Version, commit, StringComparison.Ordinal);
        Assert.Contains("`git commit` never waits", commit, StringComparison.Ordinal);
        Assert.Contains("`git merge` never waits", merge, StringComparison.Ordinal);
        Assert.DoesNotContain("{version}", commit, StringComparison.Ordinal);

        var commitLines = commit.Split('\n');
        var mergeLines = merge.Split('\n');
        Assert.Equal(commitLines.Length, mergeLines.Length);
        Assert.Single(Enumerable.Range(0, commitLines.Length), index => commitLines[index] != mergeLines[index]);
    }

    [Fact]
    public void The_hook_runs_no_git_command_that_writes()
    {
        // Comments are stripped first: the block documents this promise in a comment that names
        // the very commands it must not run.
        var script = string.Join('\n', HookBlock.Build("post-commit", Version)
            .Split('\n')
            .Where(line => !line.TrimStart().StartsWith('#')));

        Assert.DoesNotMatch(@"\bgit\s+(add|commit|stash|push|reset|checkout|switch|tag|rm)\b", script);

        foreach (var state in new[] { "rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "BISECT_LOG" })
        {
            Assert.Contains(state, script, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Installing_twice_leaves_exactly_one_block()
    {
        var block = HookBlock.Build("post-commit", Version);
        var once = HookBlock.WithBlock("", block);
        var twice = HookBlock.WithBlock(once, block);

        Assert.Equal(once, twice);
        Assert.Equal(2, once.Split(HookBlock.BeginMarker).Length);
        Assert.StartsWith("#!/bin/sh\n", once, StringComparison.Ordinal);
    }

    [Fact]
    public void Uninstalling_restores_somebody_elses_hook_byte_for_byte()
    {
        const string original = "#!/bin/sh\n# my own hook\nnpm run lint-staged\n";
        var installed = HookBlock.WithBlock(original, HookBlock.Build("post-commit", Version));

        Assert.Contains("npm run lint-staged", installed, StringComparison.Ordinal);
        Assert.Equal(original, HookBlock.WithoutBlock(installed));
    }

    [Fact]
    public void Lefthook_is_left_alone_with_the_configuration_to_add()
    {
        using var repository = new TemporaryRepository();
        File.WriteAllText(Path.Combine(repository.Root, "lefthook.yml"), "pre-commit:\n  commands: {}\n");

        var target = HookManager.ResolveTarget(repository.Git, repository.Root);

        Assert.Equal(HookOwner.Lefthook, target.Owner);
        Assert.All(HookManager.Install(target, Version), result => Assert.Equal(HookAction.Skipped, result.Action));
        Assert.False(File.Exists(Path.Combine(repository.Root, ".git", "hooks", "post-commit")));
        Assert.Contains("egehan generate --quiet", HookManager.LefthookSnippet(), StringComparison.Ordinal);
    }

    [Fact]
    public void Husky_keeps_its_own_directory()
    {
        using var repository = new TemporaryRepository();
        Directory.CreateDirectory(Path.Combine(repository.Root, ".husky", "_"));
        repository.Run("config", "core.hooksPath", ".husky/_");

        var target = HookManager.ResolveTarget(repository.Git, repository.Root);

        Assert.Equal(HookOwner.Husky, target.Owner);
        HookManager.Install(target, Version);

        Assert.True(File.Exists(Path.Combine(repository.Root, ".husky", "post-commit")));
        Assert.False(File.Exists(Path.Combine(repository.Root, ".husky", "_", "post-commit")));
    }

    [Fact]
    public void The_hooks_directory_is_the_repositorys_own_not_the_processs()
    {
        // Resolved with --absolute-git-dir. The obvious --git-dir answers a relative ".git" from
        // the root, which would install the hook wherever the tool happens to be running.
        using var repository = new TemporaryRepository();
        var target = HookManager.ResolveTarget(repository.Git, repository.Root);

        Assert.Equal(HookOwner.Git, target.Owner);
        Assert.StartsWith(repository.Root, target.Directory, StringComparison.Ordinal);

        var results = HookManager.Install(target, Version);
        Assert.All(results, result => Assert.Equal(HookAction.Created, result.Action));
        Assert.All(HookManager.Install(target, Version), result => Assert.Equal(HookAction.Unchanged, result.Action));
        Assert.All(HookManager.Uninstall(target), result => Assert.Equal(HookAction.Removed, result.Action));
    }

    [Fact]
    public void Core_hooks_path_is_honoured()
    {
        using var repository = new TemporaryRepository();
        repository.Run("config", "core.hooksPath", "tooling/githooks");

        var target = HookManager.ResolveTarget(repository.Git, repository.Root);
        HookManager.Install(target, Version);

        Assert.True(File.Exists(Path.Combine(repository.Root, "tooling", "githooks", "post-commit")));
    }
}

/// <summary>Configuration, and the messages a hand-edited file deserves.</summary>
public sealed class ConfigTests
{
    [Fact]
    public void The_privacy_default_comes_from_the_rules_file()
    {
        var rules = EgehanRules.Load();
        Assert.Equal(rules.Privacy.RedactEmailsByDefault, EgehanConfig.Default(rules).RedactEmails);
        Assert.True(EgehanConfig.Default(rules).RedactEmails);
    }

    [Fact]
    public void An_unknown_setting_is_reported_by_name()
    {
        var rules = EgehanRules.Load();
        var error = Assert.Throws<ConfigException>(() => EgehanConfig.Merge(
            EgehanConfig.Default(rules), JsonNode.Parse("""{"langauge":"tr"}"""), "test"));

        Assert.Contains("unknown setting \"langauge\"", error.Message, StringComparison.Ordinal);
        Assert.Contains("language", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"tone":"sarcastic"}""", "poetic, minimalist, humorous")]
    [InlineData("""{"redactEmails":"yes"}""", "true or false")]
    [InlineData("""{"output":""}""", "non-empty string")]
    public void An_invalid_value_says_what_was_expected(string patch, string expected)
    {
        var rules = EgehanRules.Load();
        var error = Assert.Throws<ConfigException>(
            () => EgehanConfig.Merge(EgehanConfig.Default(rules), JsonNode.Parse(patch), "test"));

        Assert.Contains(expected, error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_serialized_config_round_trips()
    {
        var rules = EgehanRules.Load();
        var original = EgehanConfig.Default(rules) with { Language = "tr", Tone = "humorous", ProjectName = "demo" };

        Assert.Equal(original, EgehanConfig.Merge(
            EgehanConfig.Default(rules), JsonNode.Parse(original.Serialize()), "test"));
    }

    [Fact]
    public void A_schema_key_is_tolerated()
    {
        var rules = EgehanRules.Load();
        var merged = EgehanConfig.Merge(
            EgehanConfig.Default(rules), JsonNode.Parse("""{"$schema":"x","tone":"poetic"}"""), "test");

        Assert.Equal("poetic", merged.Tone);
    }
}

/// <summary>Project detection, against a synthetic file list rather than a directory tree.</summary>
public sealed class DetectionTests
{
    [Theory]
    [InlineData("*.csproj", "Api.csproj", true)]
    [InlineData("*.csproj", "src/Api.csproj", false)]
    [InlineData("**/*.csproj", "src/nested/Api.csproj", true)]
    [InlineData("**/*.csproj", "Api.csproj", true)]
    [InlineData("src/*.csproj", "src/Api.csproj", true)]
    public void Globs_match_within_a_segment_and_double_stars_cross_them(string pattern, string path, bool expected)
        => Assert.Equal(expected, ProjectTypes.MatchesGlob(pattern, [path]));

    [Fact]
    public void The_strongest_detector_decides_the_flavour()
    {
        var rules = EgehanRules.Load();

        Assert.Equal("mobile", ProjectTypes.Detect(new FileSystemView(["pubspec.yaml", "package.json"], []), rules).Flavor);
        Assert.Equal("backend", ProjectTypes.Detect(new FileSystemView(["Api.csproj"], []), rules).Flavor);
        Assert.Equal("mobile", ProjectTypes.Detect(new FileSystemView([], ["ios", "android"]), rules).Flavor);

        var next = ProjectTypes.Detect(new FileSystemView(["next.config.js", "package.json"], []), rules);
        Assert.Equal("frontend", next.Flavor);
        Assert.Equal(["frontend", "node"], next.DetectedTypes);

        var nothing = ProjectTypes.Detect(new FileSystemView(["notes.txt"], []), rules);
        Assert.Empty(nothing.DetectedTypes);
        Assert.Equal(rules.ProjectTypes.FallbackFlavor, nothing.Flavor);
    }

    [Fact]
    public void A_detector_needing_several_directories_is_not_satisfied_by_one()
        => Assert.DoesNotContain(
            "native-mobile",
            ProjectTypes.Detect(new FileSystemView([], ["ios"]), EgehanRules.Load()).DetectedTypes);
}

/// <summary>The git layer, against a real repository.</summary>
public sealed class GitTests
{
    [Fact]
    public void Turkish_characters_survive_the_round_trip()
    {
        using var repository = new TemporaryRepository();
        repository.Commit("chore: ilk commit — şöyle böyle ğüşıöç", "2026-01-06T21:14:03+03:00", "README.md", "# Başlangıç\n");
        repository.Commit("feat(giriş): oturum açma", "2026-01-09T11:02:50+03:00", "src/girişler/oturum.ts", "export const a = 1;\n");

        var history = LogReader.Read(repository.Git, null, null, EgehanRules.Load());

        Assert.Equal("chore: ilk commit — şöyle böyle ğüşıöç", history.Commits[0].Subject);
        Assert.Contains(history.Commits, commit => commit.Files.Any(file => file.Path == "src/girişler/oturum.ts"));
    }

    [Fact]
    public void Annotated_tags_land_on_their_commit()
    {
        using var repository = new TemporaryRepository();
        repository.Commit("chore: ilk", "2026-01-06T21:14:03+03:00", "a.txt", "a\n");
        repository.Run("tag", "v0.1.0");
        repository.Commit("feat: ikinci", "2026-02-06T21:14:03+03:00", "b.txt", "b\n");
        repository.Run("tag", "-a", "v1.0.0", "-m", "ilk kararlı sürüm");

        var history = LogReader.Read(repository.Git, null, null, EgehanRules.Load());
        var tagged = history.Commits.Where(commit => commit.Tags.Count > 0).ToList();

        Assert.Equal(2, tagged.Count);
        // An annotated tag's object name is not the commit's, which is what breaks naive parsing.
        Assert.Contains(tagged, commit => commit.Tags.Contains("v1.0.0"));
    }

    [Fact]
    public void A_remote_url_carrying_a_token_contributes_only_its_host()
    {
        using var repository = new TemporaryRepository();
        repository.Commit("chore: ilk", "2026-01-06T21:14:03+03:00", "a.txt", "a\n");
        repository.Run("remote", "add", "origin", "https://x-access-token:ghp_notarealtoken@github.com/owner/repo.git");

        var info = Repository.Read(repository.Git);

        Assert.Equal("github.com", info.RemoteHost);
        Assert.DoesNotContain("ghp_notarealtoken", info.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void The_whole_pipeline_produces_a_chronicle_and_is_idempotent()
    {
        using var repository = new TemporaryRepository();
        File.WriteAllText(Path.Combine(repository.Root, "package.json"), "{\"name\":\"demo\"}\n");
        repository.Commit("chore: ilk commit", "2026-01-06T21:14:03+03:00", "a.txt", "a\n");
        repository.Commit("fix: token refresh race condition", "2026-03-14T03:18:42+03:00", "b.txt", "b\n");

        var options = new ProduceOptions
        {
            WorkingDirectory = repository.Root,
            ConfigOverride = EgehanConfig.Default(EgehanRules.Load()) with { Language = "tr", Tone = "poetic" },
            GeneratedAt = "2026-05-01T00:00:00+03:00",
            Version = "0.0.0-test",
        };

        var produced = Pipeline.Produce(options);

        Assert.Equal(2, produced.Report.Totals.Commits);
        Assert.Equal("frontend", produced.Report.Project.Flavor);

        var night = produced.Report.Entries.Single(entry => entry.Subject.StartsWith("fix:", StringComparison.Ordinal));
        Assert.Equal(3, night.LocalHour);
        Assert.Equal("midnight-oil", night.Category);

        var dictionary = NarrativeDictionary.Load("tr");
        var rules = EgehanRules.Load();
        var first = MarkdownRenderer.Render(produced.Report, dictionary, rules);
        var second = MarkdownRenderer.Render(Pipeline.Produce(options).Report, dictionary, rules);

        Assert.Equal(first, second);
        Assert.DoesNotContain("@example.com", first, StringComparison.Ordinal);
    }

    [Fact]
    public void A_directory_that_is_not_a_repository_explains_itself()
    {
        var empty = Directory.CreateTempSubdirectory("egehan-empty-");

        try
        {
            var error = Assert.Throws<NotARepositoryException>(() => Pipeline.Produce(new ProduceOptions
            {
                WorkingDirectory = empty.FullName,
                Version = "0.0.0-test",
            }));

            Assert.Contains("not inside a git repository", error.Message, StringComparison.Ordinal);
        }
        finally
        {
            empty.Delete(recursive: true);
        }
    }
}

/// <summary>A throwaway repository with deterministic commits.</summary>
internal sealed class TemporaryRepository : IDisposable
{
    public string Root { get; }
    public GitRunner Git { get; }

    public TemporaryRepository()
    {
        Root = Directory.CreateTempSubdirectory("egehan-dotnet-").FullName;
        Git = new GitRunner(Root, EgehanRules.Load());

        Run("init", "-b", "main");
        Run("config", "user.name", "Ada Yılmaz");
        Run("config", "user.email", "ada@example.com");
        Run("config", "commit.gpgsign", "false");

        // git resolves symlinks in its answers, and on macOS /var is a link to /private/var.
        Root = Repository.Read(Git).Root;
        Git = new GitRunner(Root, EgehanRules.Load());
    }

    public string Run(params string[] arguments) => Git.Run(arguments);

    public void Commit(string subject, string at, string path, string content)
    {
        var full = Path.Combine(Root, path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);

        Run("add", "-A");

        var info = new ProcessStartInfo("git") { WorkingDirectory = Root, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in new[] { "commit", "-m", subject }) info.ArgumentList.Add(argument);
        foreach (var variable in new[] { "GIT_AUTHOR_DATE", "GIT_COMMITTER_DATE" }) info.Environment[variable] = at;
        info.Environment["GIT_AUTHOR_NAME"] = "Ada Yılmaz";
        info.Environment["GIT_AUTHOR_EMAIL"] = "ada@example.com";
        info.Environment["GIT_COMMITTER_NAME"] = "Ada Yılmaz";
        info.Environment["GIT_COMMITTER_EMAIL"] = "ada@example.com";

        using var process = Process.Start(info)!;
        process.WaitForExit();
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
            // a leftover temp directory is not worth failing a test run over
        }
    }
}
