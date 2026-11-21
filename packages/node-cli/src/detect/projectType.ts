import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EgehanRules } from '../spec/rules.js';
import type { ProjectFlavor } from '../engine/types.js';

/**
 * Works out what kind of project this is, so the narration can borrow its vocabulary — screens and
 * touches for a mobile app, a backbone and data flow for a service.
 *
 * The scan is shallow by design (`rules.json → projectTypes.maxDepth`). Walking a whole repository
 * to find a `.csproj` would make the tool slow on exactly the large repositories where it is most
 * interesting, and a project's identity is declared at its root in practice.
 *
 * Detection is split from scanning so the rules can be tested against a synthetic file list rather
 * than a temporary directory tree — the logic is the part worth testing, not `readdirSync`.
 */

export interface FileSystemView {
  /** Repository-relative paths, always with `/` separators. */
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

export interface ProjectTypeResult {
  /** Detector ids, highest priority first. */
  readonly detectedTypes: readonly string[];
  readonly flavor: ProjectFlavor;
}

export function scanRepository(root: string, rules: EgehanRules): FileSystemView {
  const ignored = new Set(rules.projectTypes.ignoreDirs);
  const files: string[] = [];
  const directories: string[] = [];

  const walk = (absolute: string, relative: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      // An unreadable directory is not an error worth failing a chronicle over.
      return;
    }

    for (const entry of entries) {
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
        directories.push(childRelative);
        if (depth < rules.projectTypes.maxDepth) {
          walk(join(absolute, entry.name), childRelative, depth + 1);
        }
      } else if (entry.isFile()) {
        files.push(childRelative);
      }
    }
  };

  walk(root, '', 0);

  return { files: files.sort(), directories: directories.sort() };
}

export function detectProjectTypes(view: FileSystemView, rules: EgehanRules): ProjectTypeResult {
  const fileSet = new Set(view.files);
  const directorySet = new Set(view.directories);

  const matched = rules.projectTypes.detectors
    .filter((detector) => {
      if (detector.anyFile?.some((file) => fileSet.has(file)) === true) return true;
      if (detector.anyGlob?.some((pattern) => matchesGlob(pattern, view.files)) === true) return true;
      if (detector.allDirs !== undefined && detector.allDirs.length > 0) {
        return detector.allDirs.every((directory) => directorySet.has(directory));
      }
      return false;
    })
    // Priority descending, then id, so equal priorities cannot reorder between runs.
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id, 'en'));

  const strongest = matched[0];

  return {
    detectedTypes: matched.map((detector) => detector.id),
    flavor: (strongest?.flavor ?? rules.projectTypes.fallbackFlavor) as ProjectFlavor,
  };
}

/**
 * A deliberately tiny glob matcher: `*` matches within one path segment, `**` crosses segments.
 *
 * That is the whole surface the detector patterns use, and a dependency for it would be a
 * dependency in a published CLI that promises not to have any.
 */
export function matchesGlob(pattern: string, paths: readonly string[]): boolean {
  const regex = globToRegExp(pattern);
  return paths.some((path) => regex.test(path));
}

export function globToRegExp(pattern: string): RegExp {
  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` may also match zero directories, so `**/*.csproj` matches a root-level file too.
        if (pattern[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${source}$`);
}
