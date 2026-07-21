import { describe, it, expect } from 'vitest';
import { groundingEnabled } from './env.js';

describe('groundingEnabled', () => {
  it('defaults to enabled when unset or blank', () => {
    expect(groundingEnabled({})).toBe(true);
    expect(groundingEnabled({ SELDON_GROUNDING: '' })).toBe(true);
    expect(groundingEnabled({ SELDON_GROUNDING: '   ' })).toBe(true);
  });

  it('disables on falsy values (case-insensitive)', () => {
    for (const v of ['false', '0', 'off', 'no', 'FALSE', 'Off']) {
      expect(groundingEnabled({ SELDON_GROUNDING: v })).toBe(false);
    }
  });

  it('stays enabled for truthy values', () => {
    for (const v of ['true', '1', 'on', 'yes']) {
      expect(groundingEnabled({ SELDON_GROUNDING: v })).toBe(true);
    }
  });
});
