import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { hardenForWebview } from '../core/webviewHtml.js';

/**
 * The timeline panel.
 *
 * One panel per window, reused: opening the chronicle twice should bring the existing tab
 * forward, not stack editors. The webview is given scripts and nothing else — no local resource
 * roots, because the page carries everything it needs inside itself.
 */
export class ChroniclePanel {
  private static instance: ChroniclePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(title: string) {
    this.panel = vscode.window.createWebviewPanel('egehan.chronicle', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      // The chronicle is a single self-contained file; it must never reach for anything on disk.
      localResourceRoots: [],
    });

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static show(title: string, html: string): void {
    if (ChroniclePanel.instance === undefined) {
      ChroniclePanel.instance = new ChroniclePanel(title);
    }

    ChroniclePanel.instance.update(title, html);
    ChroniclePanel.instance.panel.reveal(vscode.ViewColumn.Active, false);
  }

  /** Refreshes the open panel, if there is one. Opening is a separate, deliberate action. */
  static refreshIfOpen(title: string, html: string): void {
    ChroniclePanel.instance?.update(title, html);
  }

  static get isOpen(): boolean {
    return ChroniclePanel.instance !== undefined;
  }

  private update(title: string, html: string): void {
    this.panel.title = title;
    this.panel.webview.html = hardenForWebview(html, randomBytes(16).toString('hex'));
  }

  private dispose(): void {
    ChroniclePanel.instance = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}
