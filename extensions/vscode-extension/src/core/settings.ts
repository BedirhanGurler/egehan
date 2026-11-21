/**
 * Editor settings, and what they are allowed to change.
 *
 * Language and tone default to `auto`, meaning "whatever `.egehanrc.json` says". That default is
 * the important part: the chronicle is a project-wide artifact that gets committed, so if one
 * developer's editor quietly narrated in a different language than everyone else's, the file
 * would flip back and forth in the diff with every commit. A personal setting may override it,
 * but only deliberately.
 */

export interface EgehanSettings {
  readonly language: 'auto' | 'tr' | 'en';
  readonly tone: 'auto' | 'poetic' | 'minimalist' | 'humorous';
  readonly statusBarEnabled: boolean;
  readonly statusBarAlignment: 'left' | 'right';
  readonly milestoneNotifications: boolean;
  readonly refreshOnGitChange: boolean;
  readonly maxCommits: number;
}

export const DEFAULT_SETTINGS: EgehanSettings = {
  language: 'auto',
  tone: 'auto',
  statusBarEnabled: true,
  statusBarAlignment: 'left',
  milestoneNotifications: true,
  refreshOnGitChange: true,
  maxCommits: 5000,
};

/** The overrides to hand the engine: only the settings that actually override something. */
export function overridesFrom(settings: EgehanSettings): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (settings.language !== 'auto') overrides['language'] = settings.language;
  if (settings.tone !== 'auto') overrides['tone'] = settings.tone;
  return overrides;
}
