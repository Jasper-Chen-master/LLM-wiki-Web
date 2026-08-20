import type { Project, SavedPresetProfiles, WikiProfile, WikiProfileLanguage } from "./contracts.js";

/**
 * Stores an edited built-in blueprint as a project-scoped preset override.
 * Custom blueprints are already represented by `project.profile` and should not
 * silently become a reusable built-in preset.
 */
export function rememberPresetProfile(
  existing: SavedPresetProfiles | undefined,
  profile: WikiProfile,
): SavedPresetProfiles | undefined {
  const preset = profile.preset;
  if (!preset || preset === "custom") return existing;
  const language: WikiProfileLanguage = profile.outputLanguage ?? "en";
  return {
    ...(existing ?? {}),
    [preset]: {
      ...(existing?.[preset] ?? {}),
      [language]: { ...profile, outputLanguage: language },
    },
  };
}

/** Returns the saved version for a built-in preset, if one exists for this language. */
export function getSavedPresetProfile(
  project: Pick<Project, "presetProfiles"> | undefined,
  preset: NonNullable<WikiProfile["preset"]>,
  language: WikiProfileLanguage,
): WikiProfile | undefined {
  const profile = project?.presetProfiles?.[preset]?.[language];
  return profile ? { ...profile, outputLanguage: language } : undefined;
}
