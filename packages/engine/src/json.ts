/**
 * Extracts and parses a single JSON object from an LLM response. Tolerates
 * surrounding prose or ```json fences by grabbing the outermost braces.
 */
export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const candidate = fenced.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('LLM response did not contain a JSON object');
  }
}
