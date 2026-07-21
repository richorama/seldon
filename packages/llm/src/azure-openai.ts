import { AzureOpenAI } from 'openai';
import type { CompleteOptions, LLMMessage, LLMProvider } from './provider.js';

export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

/**
 * Reads Azure OpenAI configuration from the environment.
 * Throws a helpful error listing any missing variables.
 */
export function azureConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AzureOpenAIConfig {
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const apiKey = env.AZURE_OPENAI_API_KEY;
  const deployment = env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = env.AZURE_OPENAI_API_VERSION ?? '2024-10-21';

  const missing: string[] = [];
  if (!endpoint) missing.push('AZURE_OPENAI_ENDPOINT');
  if (!apiKey) missing.push('AZURE_OPENAI_API_KEY');
  if (!deployment) missing.push('AZURE_OPENAI_DEPLOYMENT');
  if (missing.length > 0) {
    throw new Error(
      `Missing Azure OpenAI configuration: ${missing.join(', ')}. ` +
        'Set these environment variables (see README) or use the mock provider.'
    );
  }

  return { endpoint: endpoint!, apiKey: apiKey!, deployment: deployment!, apiVersion };
}

/** LLM provider backed by Azure OpenAI. */
export class AzureOpenAIProvider implements LLMProvider {
  readonly name = 'azure-openai';
  private readonly client: AzureOpenAI;
  private readonly deployment: string;

  constructor(config: AzureOpenAIConfig) {
    this.client = new AzureOpenAI({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      deployment: config.deployment
    });
    this.deployment = config.deployment;
  }

  async complete(messages: LLMMessage[], opts: CompleteOptions = {}): Promise<string> {
    const response = await this.client.chat.completions.create(
      {
        model: this.deployment,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        response_format: opts.json ? { type: 'json_object' } : undefined
      },
      { signal: opts.signal }
    );

    const content = response.choices[0]?.message?.content;
    if (content == null) throw new Error('Azure OpenAI returned no content');
    return content;
  }
}
