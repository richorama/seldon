import { describe, it, expect } from 'vitest';
import { MockProvider } from './mock.js';
import { azureConfigFromEnv } from './azure-openai.js';

describe('MockProvider', () => {
  it('returns scripted responses in order and records calls', async () => {
    const provider = new MockProvider(['first', 'second']);
    expect(await provider.complete([{ role: 'user', content: 'a' }])).toBe('first');
    expect(await provider.complete([{ role: 'user', content: 'b' }])).toBe('second');
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].messages[0].content).toBe('a');
  });

  it('throws when scripted responses are exhausted', async () => {
    const provider = new MockProvider(['only']);
    await provider.complete([{ role: 'user', content: 'x' }]);
    await expect(provider.complete([{ role: 'user', content: 'y' }])).rejects.toThrow(/ran out/);
  });

  it('supports a handler that inspects messages', async () => {
    const provider = new MockProvider((messages) =>
      messages.some((m) => m.content.includes('seed')) ? 'SEED' : 'OTHER'
    );
    expect(await provider.complete([{ role: 'user', content: 'please seed' }])).toBe('SEED');
    expect(await provider.complete([{ role: 'user', content: 'go' }])).toBe('OTHER');
  });
});

describe('azureConfigFromEnv', () => {
  it('builds config from env vars with a default api version', () => {
    const config = azureConfigFromEnv({
      AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o'
    } as NodeJS.ProcessEnv);
    expect(config.apiVersion).toBe('2024-10-21');
    expect(config.deployment).toBe('gpt-4o');
  });

  it('throws listing missing variables', () => {
    expect(() => azureConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(
      /AZURE_OPENAI_ENDPOINT.*AZURE_OPENAI_API_KEY.*AZURE_OPENAI_DEPLOYMENT/
    );
  });
});
