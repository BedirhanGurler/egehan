using System.CommandLine;
using System.Globalization;
using System.Reflection;
using Egehan.Cli;
using Egehan.Core;
using Egehan.Core.Capsule;
using Egehan.Core.Config;
using Egehan.Core.Engine;
using Egehan.Core.Git;
using Egehan.Core.Hooks;
using Egehan.Core.Spec;

/// <remarks>
/// The same command surface as the npm package, deliberately. A team with a React front end and a
/// .NET service should not have to learn two tools, and a README that documents one set of
/// commands should be true for both.
/// </remarks>

var rules = EgehanRules.Load();
var version = Assembly.GetExecutingAssembly()
    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
    .Split('+')[0] ?? "0.0.0";

/* ------------------------------------------------------------------ *
 * Shared options
 * ------------------------------------------------------------------ */

var since = new Option<string?>("--since") { Description = "start from a tag, revision or date (v1.0.0, HEAD~50, 2025-01-01)" };
var until = new Option<string?>("--until") { Description = "stop at a tag, revision or date" };
var language = new Option<string?>("--language") { Description = $"narration language ({string.Join(", ", EmbeddedAssets.AvailableLanguages())})" };
var tone = new Option<string?>("--tone") { Description = $"narrative tone ({string.Join(", ", EgehanConfig.Tones)})" };
var projectName = new Option<string?>("--project-name") { Description = "override the project name" };
var anonymize = new Option<bool>("--anonymize") { Description = "replace author names with Developer #1, #2, …" };
var keepEmails = new Option<bool>("--no-redact-emails") { Description = "keep author e-mail addresses in the output" };
var includeMerges = new Option<bool>("--include-merges") { Description = "narrate merge commits too" };

Option[] shared = [since, until, language, tone, projectName, anonymize, keepEmails, includeMerges];

EgehanConfig ConfigFor(ParseResult parse, string root)
{
    var config = EgehanConfig.Load(root, rules);

    var chosenLanguage = parse.GetValue(language);
    var chosenTone = parse.GetValue(tone);
    var chosenName = parse.GetValue(projectName);

    return config with
    {
        Language = chosenLanguage ?? config.Language,
        Tone = chosenTone ?? config.Tone,
        ProjectName = chosenName ?? config.ProjectName,
        AnonymizeAuthors = parse.GetValue(anonymize) || config.AnonymizeAuthors,
        RedactEmails = parse.GetValue(keepEmails) ? false : config.RedactEmails,
        IncludeMergeCommits = parse.GetValue(includeMerges) || config.IncludeMergeCommits,
    };
}

ProduceResult Produce(ParseResult parse)
{
    var cwd = Directory.GetCurrentDirectory();
    var probe = new GitRunner(cwd, rules);
    var root = Repository.IsGitRepository(probe) ? Repository.Read(probe).Root : cwd;

    return Pipeline.Produce(new ProduceOptions
    {
        WorkingDirectory = cwd,
        Since = parse.GetValue(since),
        Until = parse.GetValue(until),
        ConfigOverride = ConfigFor(parse, root),
        Version = version,
    });
}

/* ------------------------------------------------------------------ *
 * generate
 * ------------------------------------------------------------------ */

var output = new Option<string?>("--output", "-o") { Description = "directory to write into (default: the repository root)" };
var format = new Option<string?>("--format", "-f") { Description = $"output format ({string.Join(", ", EgehanConfig.Formats)})" };
var quiet = new Option<bool>("--quiet", "-q") { Description = "write the files and print nothing" };

var generate = new Command("generate", "write the chronicle for this repository");
foreach (var option in shared) generate.Options.Add(option);
generate.Options.Add(output);
generate.Options.Add(format);
generate.Options.Add(quiet);

generate.SetAction(parse =>
{
    var chosenFormat = parse.GetValue(format);
    if (chosenFormat is not null && !EgehanConfig.Formats.Contains(chosenFormat, StringComparer.Ordinal))
    {
        Output.Fail($"Expected one of: {string.Join(", ", EgehanConfig.Formats)}");
        return 1;
    }

    var produced = Produce(parse);
    var directory = parse.GetValue(output) ?? produced.Config.Output;
    var resolved = Path.IsPathRooted(directory) ? directory : Path.Combine(produced.RepositoryRoot, directory);

    var written = Artifacts.Write(
        produced.Report,
        NarrativeDictionary.Load(produced.Report.Config.Language),
        rules,
        resolved,
        chosenFormat ?? produced.Config.Format);

    if (parse.GetValue(quiet)) return 0;

    if (produced.Report.Range.Truncated)
    {
        Output.Warn(
            $"Only the most recent {rules.Limits.MaxCommitsPerRun} commits were read. "
            + "Narrow the range with --since to cover a specific period.");
    }

    Output.Info();
    Output.Info(
        $"{Output.Heading(produced.Report.Project.Name)} {Output.Muted("·")} "
        + $"{Output.Value(produced.Report.Totals.Commits.ToString(CultureInfo.InvariantCulture))} commits {Output.Muted("·")} "
        + $"{Output.Value(produced.Report.Range.Days.ToString(CultureInfo.InvariantCulture))} days {Output.Muted("·")} "
        + $"{Output.Value(produced.Report.Chapters.Count.ToString(CultureInfo.InvariantCulture))} chapters");

    foreach (var path in written) Output.Success(Path.GetRelativePath(Directory.GetCurrentDirectory(), path));
    Output.Info();

    return 0;
});

/* ------------------------------------------------------------------ *
 * stats
 * ------------------------------------------------------------------ */

var stats = new Command("stats", "show the Developer Pulse without writing any files");
foreach (var option in shared) stats.Options.Add(option);

stats.SetAction(parse =>
{
    var produced = Produce(parse);
    Dashboard.Render(produced.Report, NarrativeDictionary.Load(produced.Report.Config.Language));
    return 0;
});

/* ------------------------------------------------------------------ *
 * init
 * ------------------------------------------------------------------ */

var yes = new Option<bool>("--yes", "-y") { Description = "accept the defaults without asking" };
var forceInit = new Option<bool>("--force") { Description = "replace an existing .egehanrc.json" };

var init = new Command("init", "create .egehanrc.json");
init.Options.Add(yes);
init.Options.Add(forceInit);

init.SetAction(parse =>
{
    var cwd = Directory.GetCurrentDirectory();
    var probe = new GitRunner(cwd, rules);
    var repository = Repository.IsGitRepository(probe) ? Repository.Read(probe) : null;
    var root = repository?.Root ?? cwd;
    var path = EgehanConfig.PathFor(root, rules);

    if (File.Exists(path) && !parse.GetValue(forceInit))
    {
        Output.Warn($"{Path.GetRelativePath(cwd, path)} already exists. Pass --force to replace it.");
        return 0;
    }

    var config = EgehanConfig.Default(rules) with { ProjectName = repository?.Name };
    File.WriteAllText(path, config.Serialize());

    Output.Success($"Created {Path.GetRelativePath(cwd, path)}");
    Output.Info();
    Output.Info($"  {Output.Accent("egehan generate")}      {Output.Muted("write the chronicle")}");
    Output.Info($"  {Output.Accent("egehan stats")}         {Output.Muted("see the Developer Pulse")}");
    Output.Info();

    return 0;
});

/* ------------------------------------------------------------------ *
 * hook
 * ------------------------------------------------------------------ */

var hookAction = new Argument<string>("action") { Description = "install, uninstall or status" };

var hook = new Command("hook", "keep the chronicle updating after every commit and merge");
hook.Arguments.Add(hookAction);
hook.Description +=
    "\n\nThe installed hook runs in the background and never stages or commits anything."
    + "\nIt installs alongside Husky; with Lefthook it prints the configuration to add instead.";

hook.SetAction(parse =>
{
    var action = parse.GetValue(hookAction);
    if (action is not ("install" or "uninstall" or "status"))
    {
        Output.Fail("Expected one of: install, uninstall, status");
        return 1;
    }

    var cwd = Directory.GetCurrentDirectory();
    var git = new GitRunner(cwd, rules);
    if (!Repository.IsGitRepository(git)) throw new NotARepositoryException(cwd);

    var target = HookManager.ResolveTarget(git, Repository.Read(git).Root);

    Output.Info();
    Output.Info($"  {Output.Muted(target.Explanation)}");

    if (target.Owner == HookOwner.Lefthook)
    {
        Output.Info();
        Output.Info("  Add this to your lefthook configuration instead:");
        Output.Info();
        foreach (var line in HookManager.LefthookSnippet().Split('\n')) Output.Info(Output.Accent($"    {line}"));
        Output.Info();
        return 0;
    }

    if (action == "status")
    {
        Output.Info();
        foreach (var entry in HookManager.Status(target))
        {
            var mark = entry.Installed ? Output.Accent("✔") : Output.Muted("·");
            var state = entry.Installed
                ? (entry.SharedWithOtherHooks ? "installed, alongside other hooks" : "installed")
                : "not installed";
            Output.Info($"  {mark} {entry.Hook,-12} {Output.Muted(state)}");
            Output.Info($"    {Output.Muted(Path.GetRelativePath(cwd, entry.Path))}");
        }
        Output.Info();
        return 0;
    }

    var results = action == "install" ? HookManager.Install(target, version) : HookManager.Uninstall(target);

    Output.Info();
    foreach (var result in results)
    {
        var word = result.Action switch
        {
            Egehan.Core.Hooks.HookAction.Created => "installed",
            Egehan.Core.Hooks.HookAction.Updated => "updated",
            Egehan.Core.Hooks.HookAction.Unchanged => "already up to date",
            Egehan.Core.Hooks.HookAction.Removed => "removed",
            Egehan.Core.Hooks.HookAction.Absent => "was not installed",
            _ => "skipped",
        };
        Output.Success($"{Path.GetRelativePath(cwd, result.Path)} {Output.Muted($"— {word}")}");
    }

    if (action == "install")
    {
        Output.Info();
        Output.Info("  From now on the chronicle updates itself after every commit and merge.");
        Output.Info(Output.Muted("    · It runs in the background, so committing never waits for it."));
        Output.Info(Output.Muted("    · It never stages or commits anything — the files are yours to commit."));
        Output.Info(Output.Muted("    · EGEHAN_SKIP_HOOK=1 switches it off for one command."));
    }
    Output.Info();

    return 0;
});

/* ------------------------------------------------------------------ *
 * capsule
 * ------------------------------------------------------------------ */

var message = new Option<string?>("--message", "-m") { Description = "the message to seal" };
var messageFile = new Option<string?>("--message-file") { Description = "read the message from a file instead" };
var unlockDate = new Option<string?>("--unlock-date", "-d") { Description = "the date the countdown runs to (YYYY-MM-DD)" };
var author = new Option<string?>("--author", "-a") { Description = "who the message is from" };
var hint = new Option<string?>("--hint") { Description = "a passphrase hint — stored in clear text, and it travels with the file" };
var capsuleFile = new Option<string?>("--file") { Description = "where the capsule lives (default: capsule.egehan.json)" };
var open = new Option<bool>("--open") { Description = "decrypt an existing capsule and print it" };
var forceCapsule = new Option<bool>("--force") { Description = "replace an existing capsule, losing the message inside it" };

var capsule = new Command("capsule", "seal a passphrase-protected message into the chronicle, or open one");
foreach (var option in new Option[] { message, messageFile, unlockDate, author, hint, capsuleFile, open, forceCapsule })
{
    capsule.Options.Add(option);
}
// There is no --passphrase option on purpose: a secret on the command line lands in the shell
// history and in the process list.
capsule.Description +=
    "\n\nThe passphrase is always typed at a prompt, never passed as a flag."
    + "\nSet EGEHAN_PASSPHRASE for automation; be aware every child process inherits it.";

capsule.SetAction(parse =>
{
    var cwd = Directory.GetCurrentDirectory();
    var probe = new GitRunner(cwd, rules);
    var root = Repository.IsGitRepository(probe) ? Repository.Read(probe).Root : cwd;
    var path = CapsuleStorage.PathFor(root, parse.GetValue(capsuleFile), rules);

    if (parse.GetValue(open))
    {
        if (!File.Exists(path)) throw new CapsuleException($"There is no capsule at {Path.GetRelativePath(cwd, path)}.");

        var stored = CapsuleStorage.ReadFile(path, rules);
        if (!string.IsNullOrEmpty(stored.Hint)) Output.Info(Output.Muted($"Hint: {stored.Hint}"));

        var passphrase = Prompt.PassphraseFromEnvironment() ?? Prompt.Secret("Passphrase: ");
        Output.Info();
        Output.Info(TimeCapsule.Open(stored, passphrase, rules));
        Output.Info();
        return 0;
    }

    if (File.Exists(path) && !parse.GetValue(forceCapsule))
    {
        Output.Warn(
            $"{Path.GetRelativePath(cwd, path)} already exists. Pass --force to replace it — the "
            + "message inside the current one cannot be recovered afterwards.");
        return 0;
    }

    var text = parse.GetValue(messageFile) is { } file
        ? (File.Exists(Path.GetFullPath(file)) ? File.ReadAllText(Path.GetFullPath(file)) : throw new CapsuleException($"There is no file at {file}."))
        : parse.GetValue(message) ?? throw new CapsuleException("There is no message: pass --message \"…\" or --message-file <path>.");

    var date = parse.GetValue(unlockDate) ?? throw new CapsuleException("An unlock date is required: --unlock-date YYYY-MM-DD.");
    var secret = Prompt.CollectPassphrase(rules.Capsule.MinPassphraseLength);

    CapsuleStorage.Save(path, TimeCapsule.Seal(
        new SealInput(text, date, secret, parse.GetValue(author), parse.GetValue(hint), Timestamps.NowIso()),
        rules));

    Output.Success(Path.GetRelativePath(cwd, path));
    Output.Info();
    Output.Info(Output.Muted("  The capsule is embedded in the chronicle the next time you run `egehan generate`."));
    Output.Info(Output.Muted("  Nothing but the passphrase can open it, and nothing can reset the passphrase."));
    if (!string.IsNullOrEmpty(parse.GetValue(hint)))
    {
        Output.Info(Output.Warned("  The hint is stored in clear text and travels with the file."));
    }
    Output.Info(Output.Muted("  Capsule files are not tracked by git by default — keep a copy somewhere safe."));
    Output.Info();

    return 0;
});

/* ------------------------------------------------------------------ *
 * root
 * ------------------------------------------------------------------ */

var root_ = new RootCommand(
    "Turn a project's git history into a living chronicle — offline, deterministic, no API key.");
root_.Subcommands.Add(generate);
root_.Subcommands.Add(stats);
root_.Subcommands.Add(init);
root_.Subcommands.Add(hook);
root_.Subcommands.Add(capsule);

try
{
    var parsed = root_.Parse(args.Length == 0 ? ["generate"] : args);
    return parsed.Invoke();
}
catch (Exception error) when (
    error is NotARepositoryException
        or NoCommitsException
        or EmptyHistoryException
        or ConfigException
        or CapsuleException
        or PromptException
        or GitException)
{
    // Expected failures print one clear sentence. A stack trace shown for a predictable situation
    // teaches users the tool is broken when it is merely being run outside a repository.
    Output.Fail(error.Message);
    return 1;
}
catch (Exception error)
{
    Output.Fail(error.Message);
    if (Environment.GetEnvironmentVariable("EGEHAN_DEBUG") == "1")
    {
        Output.Info(Output.Muted(error.ToString()));
    }
    else
    {
        Output.Info(Output.Muted("Set EGEHAN_DEBUG=1 for a stack trace."));
    }
    return 1;
}
