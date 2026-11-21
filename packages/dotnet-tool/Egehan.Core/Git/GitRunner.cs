using System.Diagnostics;
using System.Text;
using Egehan.Core.Spec;

namespace Egehan.Core.Git;

/// <summary>
/// The only place in this engine that invokes git.
/// </summary>
/// <remarks>
/// Everything here exists because of one failure mode: a chronicle whose Turkish commit messages
/// arrive as <c>Ã¼</c>. The encoding flags from <c>rules.json → git.mandatoryFlags</c> are applied
/// to every invocation without exception, output is decoded as UTF-8 explicitly rather than
/// trusting the console code page, and <c>core.quotepath=false</c> keeps non-ASCII paths readable.
///
/// Arguments are passed as a list, never as a command line string, so a branch or tag containing
/// a space or a quote is data rather than syntax.
/// </remarks>
public sealed class GitException(IReadOnlyList<string> arguments, int exitCode, string stderr)
    : InvalidOperationException($"git {string.Join(' ', arguments)} failed (exit {exitCode}): {stderr.Trim()}")
{
    public IReadOnlyList<string> Arguments { get; } = arguments;
    public int ExitCode { get; } = exitCode;
    public string StandardError { get; } = stderr;
}

public sealed record GitResult(string StandardOutput, string StandardError, int ExitCode);

public sealed class GitRunner(string workingDirectory, EgehanRules rules)
{
    public string WorkingDirectory { get; } = workingDirectory;
    public EgehanRules Rules { get; } = rules;

    public GitRunner At(string directory) => new(directory, Rules);

    /// <summary>Runs git and throws on failure.</summary>
    public string Run(params string[] arguments)
    {
        var result = Try(arguments);
        if (result.ExitCode != 0) throw new GitException(arguments, result.ExitCode, result.StandardError);
        return result.StandardOutput;
    }

    /// <summary>Runs git and returns the failure, for probes like <c>rev-parse --verify</c>.</summary>
    public GitResult Try(params string[] arguments)
    {
        var info = new ProcessStartInfo("git")
        {
            WorkingDirectory = WorkingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
        };

        foreach (var flag in Rules.Git.MandatoryFlags) info.ArgumentList.Add(flag);
        foreach (var argument in arguments) info.ArgumentList.Add(argument);

        // An explicit, minimal environment for the variables that change git's output: a user
        // with a pager configured would otherwise get different results from the same repository.
        info.Environment["GIT_PAGER"] = "cat";
        info.Environment["GIT_TERMINAL_PROMPT"] = "0";
        info.Environment["LC_ALL"] = "C.UTF-8";

        using var process = new Process { StartInfo = info };

        try
        {
            process.Start();
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new InvalidOperationException(
                "git was not found on this system. Egehan reads history with git and cannot work without it.",
                error);
        }

        // Read both streams before waiting: a large log fills the pipe buffer and would otherwise
        // deadlock against a process waiting for someone to drain it.
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();

        return new GitResult(Strip(stdout.Result), stderr.Result, process.ExitCode);
    }

    /// <summary>Removes a UTF-8 byte order mark, which git on Windows can emit.</summary>
    private static string Strip(string value)
        => value.Length > 0 && value[0] == '﻿' ? value[1..] : value;
}
