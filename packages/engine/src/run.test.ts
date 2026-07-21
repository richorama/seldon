import { describe, it, expect } from 'vitest';
import { MockProvider } from '@seldon/llm';
import { predict } from './run.js';
import { manifestToMarkdown } from './render.js';
import type { RunOptions } from './types.js';

const OPTIONS: RunOptions = {
  maxTurns: 3,
  maxVagents: 6,
  concurrency: 2,
  grounded: false,
  model: 'mock'
};

/** Which entity a turn prompt is role-playing (by slug in the system message). */
function slugOf(messages: { content: string }[]): string {
  const m = messages.map((x) => x.content).join('\n');
  const match = m.match(/Wikipedia slug: ([A-Za-z0-9_]+)/);
  return match ? match[1] : '';
}
function isSeed(messages: { content: string }[]): boolean {
  return messages.some((x) => x.content.includes('seeding step'));
}
function isSummary(messages: { content: string }[]): boolean {
  return messages.some((x) => x.content.includes('summarisation step'));
}

describe('predict (full mock run)', () => {
  it('seeds, deliberates across turns and produces a dated timeline + report', async () => {
    const provider = new MockProvider((messages) => {
      if (isSeed(messages)) {
        return JSON.stringify({
          entities: [
            { slug: 'Country_A', name: 'Country A', type: 'country' },
            { slug: 'Country_B', name: 'Country B', type: 'country' }
          ]
        });
      }
      if (isSummary(messages)) {
        return '## Executive forecast\nTensions ease.';
      }
      const slug = slugOf(messages);
      const turnMatch = messages
        .map((x) => x.content)
        .join('\n')
        .match(/turn (\d+)/);
      const turn = turnMatch ? Number(turnMatch[1]) : 1;

      // Country_A: responds turn 1 (and nominates Country_C), then goes quiet.
      if (slug === 'Country_A') {
        if (turn === 1) {
          return JSON.stringify({
            memoryNote: 'Opened dialogue.',
            response: { date: '2026-09-01', text: 'A proposes talks.', confidence: 'medium' },
            suggestEntities: [{ slug: 'Country_C', name: 'Country C', type: 'country' }]
          });
        }
        return JSON.stringify({ response: null });
      }
      // Country_B: responds turn 1, withdraws turn 2.
      if (slug === 'Country_B') {
        if (turn === 1) {
          return JSON.stringify({
            response: { date: '2026-08-15', text: 'B signals openness.' }
          });
        }
        return JSON.stringify({ withdraw: true });
      }
      // Country_C (nominated): responds on its first active turn (turn 2) only.
      if (slug === 'Country_C') {
        if (turn === 2) {
          return JSON.stringify({
            response: { date: '2026-10-01', text: 'C offers to mediate.' }
          });
        }
        return JSON.stringify({ response: null });
      }
      return JSON.stringify({ response: null });
    });

    const manifest = await predict({
      question: 'Will A and B de-escalate?',
      provider,
      options: OPTIONS
    });

    // Timeline sorted by future date.
    expect(manifest.timeline.map((r) => r.date)).toEqual([
      '2026-08-15',
      '2026-09-01',
      '2026-10-01'
    ]);
    expect(manifest.timeline.map((r) => r.entitySlug)).toEqual([
      'Country_B',
      'Country_A',
      'Country_C'
    ]);

    // Nominated entity is present and attributed.
    const c = manifest.entities.find((e) => e.slug === 'Country_C');
    expect(c?.nominatedBy).toBe('Country_A');

    // Withdrawal reflected in roster.
    expect(manifest.entities.find((e) => e.slug === 'Country_B')?.status).toBe('withdrawn');

    // Report present and markdown render works.
    expect(manifest.report).toContain('Executive forecast');
    expect(manifestToMarkdown(manifest)).toContain('# Seldon forecast');
    expect(manifest.turnsRun).toBeGreaterThanOrEqual(2);
  });

  it('coerces malformed vagent output to a no-op without crashing', async () => {
    const provider = new MockProvider((messages) => {
      if (isSeed(messages)) {
        return JSON.stringify({ entities: [{ slug: 'X', name: 'X', type: 'other' }] });
      }
      if (isSummary(messages)) return '## Executive forecast\nInconclusive.';
      return 'not json at all';
    });
    const manifest = await predict({ question: 'What happens?', provider, options: OPTIONS });
    expect(manifest.timeline).toHaveLength(0);
    expect(manifest.report).toContain('Inconclusive');
  });

  it('honours the maxVagents cap on nominations', async () => {
    const provider = new MockProvider((messages) => {
      if (isSeed(messages)) {
        return JSON.stringify({ entities: [{ slug: 'Root', name: 'Root', type: 'organisation' }] });
      }
      if (isSummary(messages)) return 'ok';
      const slug = slugOf(messages);
      if (slug === 'Root') {
        const turnMatch = messages
          .map((x) => x.content)
          .join('\n')
          .match(/turn (\d+)/);
        const turn = turnMatch ? Number(turnMatch[1]) : 1;
        if (turn === 1) {
          return JSON.stringify({
            response: { date: '2027-01-01', text: 'spawning' },
            suggestEntities: [
              { slug: 'N1', name: 'N1', type: 'other' },
              { slug: 'N2', name: 'N2', type: 'other' },
              { slug: 'N3', name: 'N3', type: 'other' }
            ]
          });
        }
        return JSON.stringify({ response: null });
      }
      return JSON.stringify({ response: null });
    });
    const manifest = await predict({
      question: 'q',
      provider,
      options: { ...OPTIONS, maxVagents: 2 }
    });
    // Root + one nominee accepted; the rest dropped.
    expect(manifest.entities).toHaveLength(2);
    expect(manifest.droppedNominations.length).toBe(2);
  });
});
