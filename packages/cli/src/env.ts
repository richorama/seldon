import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads a .env file into process.env if present, using Node's built-in
 * loadEnvFile when available (Node >= 20.12). Existing env vars take precedence.
 * Silent no-op when no file is found.
 */
export function loadDotenv(path = resolve(process.cwd(), '.env')): void {
  if (!existsSync(path)) return;
  const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loader === 'function') {
    loader(path);
  }
}

/**
 * Whether Wikipedia grounding is enabled, read from the SELDON_GROUNDING env
 * var. Grounding is on by default; set SELDON_GROUNDING to a falsy value
 * (false/0/off/no) to disable it.
 */
export function groundingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SELDON_GROUNDING;
  if (raw === undefined || raw.trim() === '') return true;
  return !/^(false|0|off|no)$/i.test(raw.trim());
}

/**
 * Whether the built-in red-team "Devil's Advocate" vagent is enabled, read from
 * the SELDON_SKEPTIC env var. On by default; set SELDON_SKEPTIC to a falsy value
 * (false/0/off/no) to disable it.
 */
export function skepticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SELDON_SKEPTIC;
  if (raw === undefined || raw.trim() === '') return true;
  return !/^(false|0|off|no)$/i.test(raw.trim());
}

/**
 * Whether the built-in "think big" Visionary vagent is enabled, read from the
 * SELDON_VISIONARY env var. On by default; set SELDON_VISIONARY to a falsy value
 * (false/0/off/no) to disable it.
 */
export function visionaryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SELDON_VISIONARY;
  if (raw === undefined || raw.trim() === '') return true;
  return !/^(false|0|off|no)$/i.test(raw.trim());
}
