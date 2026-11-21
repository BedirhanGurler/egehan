/**
 * Preparing the generated chronicle for a VS Code webview.
 *
 * The file the CLI writes is meant to be opened from disk, where it is just a page. Inside the
 * editor it runs next to the user's source code, so it is served under a Content-Security-Policy
 * that permits exactly what the page needs and nothing else: no network of any kind, and scripts
 * and styles only from the nonce issued for this panel.
 *
 * This is belt and braces rather than a fix for a known hole — the page already writes every
 * repository-derived string with `textContent` and escapes `<` inside its JSON. The point is that
 * if either of those ever regressed, the policy would still stand between a commit message and
 * the editor.
 */

export interface HardenOptions {
  /** Force the page to follow the editor's own light/dark theme rather than the project setting. */
  readonly followEditorTheme?: boolean;
}

const CHARSET_META = '<meta charset="utf-8" />';

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    'img-src data:',
    "font-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

export function hardenForWebview(html: string, nonce: string, options: HardenOptions = {}): string {
  if (!/^[A-Za-z0-9]{16,}$/.test(nonce)) {
    throw new Error('A webview nonce must be at least 16 alphanumeric characters.');
  }
  if (!html.includes(CHARSET_META)) {
    throw new Error('The chronicle does not look like an Egehan page: its charset meta is missing.');
  }

  let result = html.replace(
    CHARSET_META,
    `${CHARSET_META}\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(nonce)}" />`,
  );

  // Every script and style element gets the nonce, data blocks included: a `type="application/json"`
  // block is never executed, so the nonce costs nothing and avoids reasoning about which is which.
  result = result.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
  result = result.replace(/<style(?![^>]*\bnonce=)/g, `<style nonce="${nonce}"`);

  if (options.followEditorTheme !== false) {
    // Inside the editor the page should match the editor, not the project's exported preference.
    result = result.replace(/(<html\b[^>]*?)\sdata-theme="[^"]*"/, '$1 data-theme="auto"');
  }

  return result;
}
