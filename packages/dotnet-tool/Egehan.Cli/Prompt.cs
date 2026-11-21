using System.Text;
using Egehan.Core.Capsule;

namespace Egehan.Cli;

/// <summary>
/// Reading a passphrase.
/// </summary>
/// <remarks>
/// There is deliberately no <c>--passphrase</c> option. A secret passed on the command line lands
/// in the shell's history file and is visible to every other process through the process list —
/// for a passphrase meant to hold for years, and which cannot be reset, that is not a trade worth
/// making for a few saved keystrokes (docs/ARCHITECTURE.md, ADR-012).
///
/// <c>EGEHAN_PASSPHRASE</c> exists for automation. It is better than a flag and still worse than
/// typing: an environment variable is inherited by every child process, and the CLI says so.
/// </remarks>
internal sealed class PromptException(string message) : InvalidOperationException(message);

internal static class Prompt
{
    public const string PassphraseVariable = "EGEHAN_PASSPHRASE";

    public static string? PassphraseFromEnvironment()
    {
        var value = Environment.GetEnvironmentVariable(PassphraseVariable);
        return string.IsNullOrEmpty(value) ? null : value;
    }

    /// <summary>Asks a question with the typed characters hidden.</summary>
    public static string Secret(string question)
    {
        if (Console.IsInputRedirected)
        {
            throw new PromptException(
                $"A passphrase is needed, but this is not an interactive terminal. Set {PassphraseVariable} "
                + "to supply one without a prompt.");
        }

        Console.Out.Write(question);
        var builder = new StringBuilder();

        while (true)
        {
            var key = Console.ReadKey(intercept: true);

            if (key.Key == ConsoleKey.Enter)
            {
                Console.Out.WriteLine();
                return builder.ToString();
            }

            if (key.Key == ConsoleKey.Backspace)
            {
                if (builder.Length > 0) builder.Length -= 1;
                continue;
            }

            // Control keys produce no character; only real input is collected, and nothing is
            // echoed, so the passphrase never reaches the screen or the scrollback.
            if (!char.IsControl(key.KeyChar)) builder.Append(key.KeyChar);
        }
    }

    public static string CollectPassphrase(int minimum)
    {
        var fromEnvironment = PassphraseFromEnvironment();
        if (fromEnvironment is not null)
        {
            Output.Warn($"Using the passphrase from {PassphraseVariable}. Every child process inherits that variable.");
            return fromEnvironment;
        }

        Output.Info();
        Output.Info(Output.Muted($"  At least {minimum} characters. There is no way to recover or reset it."));

        var first = Secret("  Passphrase: ");
        var second = Secret("  Again: ");

        if (!TimeCapsule.PassphrasesMatch(first, second))
        {
            throw new CapsuleException("The two passphrases are not the same. Nothing was written.");
        }

        return first;
    }
}
