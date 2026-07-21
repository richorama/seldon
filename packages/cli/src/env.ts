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
