import type { RunManifest } from './types.js';

/** Renders a run manifest into a standalone Markdown document. */
export function manifestToMarkdown(manifest: RunManifest): string {
  const lines: string[] = [];
  lines.push(`# Seldon forecast`);
  lines.push('');
  lines.push(`> **Question:** ${manifest.question}`);
  lines.push('>');
  lines.push(`> Generated ${manifest.createdAt} · model \`${manifest.options.model}\` · ` +
    `${manifest.turnsRun} turn(s) · stopped: ${manifest.stoppedBecause}`);
  lines.push('');
  lines.push(manifest.report ?? '_No report generated._');
  lines.push('');
  lines.push('## Entities involved');
  lines.push('');
  for (const e of manifest.entities) {
    const flag = e.status === 'withdrawn' ? ' _(withdrawn)_' : '';
    const via = e.nominatedBy ? ` — nominated by \`${e.nominatedBy}\`` : '';
    lines.push(`- [${e.name}](${e.wikipediaUrl}) (${e.type})${flag}${via}`);
  }
  if (manifest.droppedNominations.length) {
    lines.push('');
    lines.push(`_Dropped nominations (cap reached): ${manifest.droppedNominations.join(', ')}_`);
  }
  return lines.join('\n') + '\n';
}

/** A short entity roster for terminal output. */
export function entityListText(manifest: RunManifest): string {
  return manifest.entities
    .map((e) => {
      const flag = e.status === 'withdrawn' ? ' (withdrawn)' : '';
      return `  • ${e.name} [${e.type}] ${e.wikipediaUrl}${flag}`;
    })
    .join('\n');
}
