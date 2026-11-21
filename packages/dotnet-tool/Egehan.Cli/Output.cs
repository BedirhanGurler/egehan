namespace Egehan.Cli;

/// <summary>
/// Terminal output.
/// </summary>
/// <remarks>
/// Colour is suppressed when the stream is redirected, when <c>NO_COLOR</c> is set, or when the
/// terminal is dumb — which together cover piping to a file, CI logs and the git hook that runs
/// this tool in the background.
/// </remarks>
internal static class Output
{
    private static readonly bool ColorEnabled = DecideColor();

    private static bool DecideColor()
    {
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("NO_COLOR"))) return false;
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("FORCE_COLOR"))) return true;
        if (Environment.GetEnvironmentVariable("TERM") == "dumb") return false;
        return !Console.IsOutputRedirected;
    }

    private static string Paint(string code, string text) => ColorEnabled ? $"\u001b[{code}m{text}\u001b[0m" : text;

    public static string Heading(string text) => Paint("1", text);
    public static string Accent(string text) => Paint("32", text);
    public static string Muted(string text) => Paint("2", text);
    public static string Warned(string text) => Paint("33", text);
    public static string Value(string text) => Paint("36;1", text);

    public static void Info(string message = "") => Console.Out.WriteLine(message);
    public static void Success(string message) => Console.Out.WriteLine($"{Accent("✔")} {message}");
    public static void Warn(string message) => Console.Error.WriteLine($"{Warned("!")} {message}");
    public static void Fail(string message) => Console.Error.WriteLine($"{Paint("31;1", "✖")} {message}");

    /// <summary>
    /// Column width as a terminal renders it: an emoji takes two, a combining mark none.
    /// </summary>
    public static int VisibleWidth(string text)
    {
        var width = 0;

        for (var index = 0; index < text.Length; index += 1)
        {
            if (char.IsHighSurrogate(text[index]) && index + 1 < text.Length)
            {
                width += 2; // every astral character this tool prints is an emoji
                index += 1;
                continue;
            }

            var codePoint = text[index];
            if (codePoint == '️') { width += 1; continue; }
            if (codePoint == '‍' || (codePoint >= '︀' && codePoint <= '︎')) continue;
            if (codePoint >= '̀' && codePoint <= 'ͯ') continue;

            width += IsWide(codePoint) ? 2 : 1;
        }

        return width;
    }

    private static bool IsWide(char codePoint)
        => (codePoint >= 'ᄀ' && codePoint <= 'ᅟ')
            || (codePoint >= '⺀' && codePoint <= '〾')
            || (codePoint >= 'ぁ' && codePoint <= '㏿')
            || (codePoint >= '㐀' && codePoint <= '䶿')
            || (codePoint >= '一' && codePoint <= '鿿')
            || (codePoint >= '가' && codePoint <= '힣')
            || (codePoint >= '豈' && codePoint <= '﫿')
            || (codePoint >= '︰' && codePoint <= '﹯')
            || (codePoint >= '＀' && codePoint <= '｠');
}
