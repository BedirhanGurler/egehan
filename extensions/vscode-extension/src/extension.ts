import { join } from 'node:path';
import * as vscode from 'vscode';
import { buildChronicle, loadEgehan, type Chronicle } from './core/chronicle.js';
import { celebrationText, diffMilestones } from './core/milestones.js';
import { DEFAULT_SETTINGS, overridesFrom, type EgehanSettings } from './core/settings.js';
import { statusBarContent } from './core/statusBar.js';
import { ChroniclePanel } from './vscode/panel.js';

/**
 * Egehan for VS Code.
 *
 * Three behaviours, in order of how often they matter: a status bar entry showing how old the
 * project is and how much is in it, a timeline panel one click away, and a quiet notification
 * when the project reaches a milestone.
 *
 * The extension reads history through the `egehan` library rather than the CLI, so what the
 * status bar says and what the git hook writes can never disagree. Refreshing is debounced and
 * capped, because an editor that stutters while you type is worse than one that tells you nothing.
 */

const SEEN_MILESTONES_KEY = 'egehan.seenMilestones';
const REFRESH_DEBOUNCE_MS = 1200;

let statusBar: vscode.StatusBarItem | undefined;
let output: vscode.LogOutputChannel;
let refreshTimer: NodeJS.Timeout | undefined;
let watchers: vscode.Disposable[] = [];
let lastChronicle: Chronicle | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Egehan', { log: true });
  context.subscriptions.push(output);

  const assets = join(context.extensionPath, 'assets');

  context.subscriptions.push(
    vscode.commands.registerCommand('egehan.openChronicle', () => openChronicle(context, assets)),
    vscode.commands.registerCommand('egehan.regenerate', () => regenerate(context, assets)),
    vscode.commands.registerCommand('egehan.showPulse', () => showPulse(context, assets)),
    vscode.commands.registerCommand('egehan.refresh', () => refresh(context, assets, true)),
    vscode.commands.registerCommand('egehan.installHooks', () => manageHooks(assets, 'install')),
    vscode.commands.registerCommand('egehan.uninstallHooks', () => manageHooks(assets, 'uninstall')),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('egehan')) {
        rebuildStatusBar(context);
        installWatchers(context, assets);
        void refresh(context, assets, false);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      installWatchers(context, assets);
      void refresh(context, assets, false);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => void refresh(context, assets, false)),
  );

  rebuildStatusBar(context);
  installWatchers(context, assets);
  await refresh(context, assets, false);
}

export function deactivate(): void {
  if (refreshTimer !== undefined) clearTimeout(refreshTimer);
  disposeWatchers();
  statusBar?.dispose();
}

/* ------------------------------------------------------------------ *
 * Settings and the status bar
 * ------------------------------------------------------------------ */

function readSettings(): EgehanSettings {
  const config = vscode.workspace.getConfiguration('egehan');

  return {
    language: config.get('language', DEFAULT_SETTINGS.language),
    tone: config.get('tone', DEFAULT_SETTINGS.tone),
    statusBarEnabled: config.get('statusBar.enabled', DEFAULT_SETTINGS.statusBarEnabled),
    statusBarAlignment: config.get('statusBar.alignment', DEFAULT_SETTINGS.statusBarAlignment),
    milestoneNotifications: config.get('notifications.milestones', DEFAULT_SETTINGS.milestoneNotifications),
    refreshOnGitChange: config.get('refreshOnGitChange', DEFAULT_SETTINGS.refreshOnGitChange),
    maxCommits: config.get('maxCommits', DEFAULT_SETTINGS.maxCommits),
  };
}

function rebuildStatusBar(context: vscode.ExtensionContext): void {
  statusBar?.dispose();
  statusBar = undefined;

  const settings = readSettings();
  if (!settings.statusBarEnabled) return;

  statusBar = vscode.window.createStatusBarItem(
    settings.statusBarAlignment === 'right'
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.command = 'egehan.openChronicle';
  context.subscriptions.push(statusBar);
}

/* ------------------------------------------------------------------ *
 * Refreshing
 * ------------------------------------------------------------------ */

function activeFolder(): vscode.WorkspaceFolder | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder !== undefined) return folder;
  }
  return vscode.workspace.workspaceFolders?.[0];
}

async function refresh(
  context: vscode.ExtensionContext,
  assets: string,
  announceFailure: boolean,
): Promise<void> {
  const folder = activeFolder();
  if (folder === undefined) {
    statusBar?.hide();
    return;
  }

  const settings = readSettings();

  try {
    const chronicle = await buildChronicle(assets, folder.uri.fsPath, settings);
    lastChronicle = chronicle;

    if (statusBar !== undefined) {
      const content = statusBarContent(
        chronicle.report,
        chronicle.dictionary.ui as Record<string, string>,
        chronicle.dictionary.pulse.labels as Record<string, string>,
      );
      statusBar.text = content.text;
      statusBar.tooltip = content.tooltip;
      statusBar.show();
    }

    if (ChroniclePanel.isOpen) {
      const egehan = await loadEgehan(assets);
      ChroniclePanel.refreshIfOpen(
        chronicle.report.project.name,
        egehan.renderHtml(chronicle.report, chronicle.dictionary),
      );
    }

    await announceMilestones(context, chronicle, settings);
  } catch (error) {
    // Not a repository, no commits yet, a broken config: all ordinary situations in an editor
    // that opens whatever folder you point it at. The status bar simply steps aside, and the
    // detail goes to the log for anyone who asks a command and gets nothing.
    lastChronicle = undefined;
    statusBar?.hide();

    const message = error instanceof Error ? error.message : String(error);
    output.debug(`Chronicle unavailable for ${folder.name}: ${message}`);
    if (announceFailure) void vscode.window.showWarningMessage(message);
  }
}

function scheduleRefresh(context: vscode.ExtensionContext, assets: string): void {
  if (refreshTimer !== undefined) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(context, assets, false), REFRESH_DEBOUNCE_MS);
}

/**
 * Watches the one file that moves whenever history does.
 *
 * `.git/logs/HEAD` gets a line appended on every commit, merge, checkout, reset and rebase step,
 * and unlike the index it is not rewritten constantly while you work. Watching it is far cheaper
 * than polling and far simpler than depending on another extension's API.
 */
function installWatchers(context: vscode.ExtensionContext, assets: string): void {
  disposeWatchers();
  if (!readSettings().refreshOnGitChange) return;

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const pattern of ['.git/logs/HEAD', '.egehanrc.json']) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
      const trigger = (): void => scheduleRefresh(context, assets);
      watcher.onDidChange(trigger);
      watcher.onDidCreate(trigger);
      watcher.onDidDelete(trigger);
      watchers.push(watcher);
    }
  }

  context.subscriptions.push(...watchers);
}

function disposeWatchers(): void {
  for (const watcher of watchers) watcher.dispose();
  watchers = [];
}

/* ------------------------------------------------------------------ *
 * Milestones
 * ------------------------------------------------------------------ */

async function announceMilestones(
  context: vscode.ExtensionContext,
  chronicle: Chronicle,
  settings: EgehanSettings,
): Promise<void> {
  if (!settings.milestoneNotifications) return;

  const key = `${SEEN_MILESTONES_KEY}:${chronicle.repositoryRoot}`;
  const stored = context.workspaceState.get<string[]>(key);
  const diff = diffMilestones(chronicle.report, stored);

  await context.workspaceState.update(key, diff.seen);

  // The first run records history without announcing it. A four-year-old repository has dozens
  // of milestones, and a wall of notifications on install is the fastest way to be uninstalled.
  if (diff.seeded) {
    output.info(`Recorded ${diff.seen.length} existing milestone(s) without announcing them.`);
    return;
  }

  const celebration = celebrationText(diff.announce, chronicle.dictionary.milestones.celebration.title);
  if (celebration === null) return;

  const open = chronicle.dictionary.milestones.celebration.action;
  const choice = await vscode.window.showInformationMessage(
    `${celebration.headline} ${celebration.detail}`,
    open,
  );
  if (choice === open) await vscode.commands.executeCommand('egehan.openChronicle');
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

async function withChronicle(
  context: vscode.ExtensionContext,
  assets: string,
): Promise<Chronicle | undefined> {
  if (lastChronicle === undefined) await refresh(context, assets, true);
  return lastChronicle;
}

async function openChronicle(context: vscode.ExtensionContext, assets: string): Promise<void> {
  const chronicle = await withChronicle(context, assets);
  if (chronicle === undefined) return;

  const egehan = await loadEgehan(assets);
  ChroniclePanel.show(
    chronicle.report.project.name,
    egehan.renderHtml(chronicle.report, chronicle.dictionary),
  );
}

async function showPulse(context: vscode.ExtensionContext, assets: string): Promise<void> {
  const chronicle = await withChronicle(context, assets);
  if (chronicle === undefined) return;

  const open = chronicle.dictionary.ui['openChronicle'] ?? 'Open';
  const choice = await vscode.window.showInformationMessage(chronicle.report.pulse.narrative, open);
  if (choice === open) await vscode.commands.executeCommand('egehan.openChronicle');
}

async function regenerate(context: vscode.ExtensionContext, assets: string): Promise<void> {
  const chronicle = await withChronicle(context, assets);
  if (chronicle === undefined) return;

  const egehan = (await loadEgehan(assets)) as unknown as {
    writeArtifacts: (options: unknown) => string[];
    loadRules: () => { output: { markdownFileName: string } };
  };

  const written = egehan.writeArtifacts({
    report: chronicle.report,
    dictionary: chronicle.dictionary,
    rules: egehan.loadRules(),
    outputDirectory: chronicle.repositoryRoot,
    format: 'both',
  });

  output.info(`Wrote ${written.length} file(s): ${written.join(', ')}`);
  void vscode.window.showInformationMessage(
    written.map((path) => path.split(/[\\/]/).pop() ?? path).join(' · '),
  );
}

async function manageHooks(assets: string, action: 'install' | 'uninstall'): Promise<void> {
  const folder = activeFolder();
  if (folder === undefined) return;

  const egehan = (await loadEgehan(assets)) as unknown as {
    loadRules: () => unknown;
    resolveHookTarget: (
      context: { cwd: string; rules: unknown },
      root: string,
    ) => {
      owner: string;
      explanation: string;
    };
    installHooks: (target: unknown, version: string) => { hook: string; action: string }[];
    uninstallHooks: (target: unknown) => { hook: string; action: string }[];
    packageVersion: () => string;
    produceReport: (options: { cwd: string }) => { repositoryRoot: string };
  };

  try {
    const root = egehan.produceReport({ cwd: folder.uri.fsPath }).repositoryRoot;
    const target = egehan.resolveHookTarget({ cwd: folder.uri.fsPath, rules: egehan.loadRules() }, root);

    if (target.owner === 'lefthook') {
      void vscode.window.showWarningMessage(target.explanation);
      return;
    }

    const results =
      action === 'install'
        ? egehan.installHooks(target, egehan.packageVersion())
        : egehan.uninstallHooks(target);

    const summary = results.map((result) => `${result.hook}: ${result.action}`).join(' · ');
    output.info(summary);
    void vscode.window.showInformationMessage(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showWarningMessage(message);
  }
}
