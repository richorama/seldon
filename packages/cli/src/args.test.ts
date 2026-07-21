import { describe, it, expect } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses a question with defaults', () => {
    const a = parseArgs(['Will it rain tomorrow?']);
    expect(a.question).toBe('Will it rain tomorrow?');
    expect(a.turns).toBe(4);
    expect(a.maxAgents).toBe(12);
    expect(a.concurrency).toBe(4);
    expect(a.save).toBeNull();
  });

  it('joins multiple positional tokens into the question', () => {
    const a = parseArgs(['Will', 'A', 'and', 'B', 'de-escalate?']);
    expect(a.question).toBe('Will A and B de-escalate?');
  });

  it('parses numeric and boolean flags', () => {
    const a = parseArgs(['q', '--turns', '6', '--max-agents', '20', '--verbose']);
    expect(a.turns).toBe(6);
    expect(a.maxAgents).toBe(20);
    expect(a.verbose).toBe(true);
  });

  it('treats --save as an optional-value flag', () => {
    expect(parseArgs(['q', '--save']).save).toBe('');
    expect(parseArgs(['q', '--save', 'out/dir']).save).toBe('out/dir');
    // A following flag must not be consumed as the save path.
    const a = parseArgs(['q', '--save', '--json']);
    expect(a.save).toBe('');
    expect(a.json).toBe(true);
  });

  it('splits --seed into slugs', () => {
    expect(parseArgs(['q', '--seed', 'United_Nations, European_Union']).seed).toEqual([
      'United_Nations',
      'European_Union'
    ]);
  });

  it('rejects invalid integers and unknown options', () => {
    expect(() => parseArgs(['q', '--turns', 'x'])).toThrow(/positive integer/);
    expect(() => parseArgs(['q', '--nope'])).toThrow(/Unknown option/);
  });
});
