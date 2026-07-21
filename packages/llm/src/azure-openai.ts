import OpenAI from 'openai';
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
 * Accepts either AZURE_OPENAI_API_KEY or AZURE_OPENAI_KEY for the key.
 */
export function azureConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AzureOpenAIConfig {
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const apiKey = env.AZURE_OPENAI_API_KEY ?? env.AZURE_OPENAI_KEY;
  const deployment = env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = env.AZURE_OPENAI_API_VERSION ?? '2024-10-21';

  const missing: string[] = [];
  if (!endpoint) missing.push('AZURE_OPENAI_ENDPOINT');
  if (!apiKey) missing.push('AZURE_OPENAI_API_KEY (or AZURE_OPENAI_KEY)');
  if (!deployment) missing.push('AZURE_OPENAI_DEPLOYMENT');
  if (missing.length > 0) {
    throw new Error(
      `Missing Azure OpenAI configuration: ${missing.join(', ')}. ` +
        'Set these environment variables (see README) or use the mock provider.'
    );
  }

  return { endpoint: endpoint!, apiKey: apiKey!, deployment: deployment!, apiVersion };
}

/**
 * Derives the v1 API base URL from a configured endpoint. Accepts:
 *  - a bare host: https://res.services.ai.azure.com
 *  - a classic host: https://res.openai.azure.com
 *  - a full v1 path: https://res.services.ai.azure.com/openai/v1/responses
 * and normalises all of them to `<host>/openai/v1/`.
 */
export function toV1BaseUrl(endpoint: string): string {
  const host = endpoint.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  return `${host}/openai/v1/`;
}

/**
 * LLM provider backed by Azure OpenAI's v1 API (Azure AI Foundry / AI Services).
 * Uses the OpenAI client pointed at `<host>/openai/v1/` with the `api-key`
 * header. Gracefully drops `temperature` for reasoning models that only allow
 * the default value.
 */
export class AzureOpenAIProvider implements LLMProvider {
  readonly name = 'azure-openai';
  private readonly client: OpenAI;
  private readonly deployment: string;
  private supportsTemperature = true;

  constructor(config: AzureOpenAIConfig) {
    this.client = new OpenAI({
      baseURL: toV1BaseUrl(config.endpoint),
      apiKey: config.apiKey,
      defaultHeaders: { 'api-key': config.apiKey }
    });
    this.deployment = config.deployment;
  }

  async complete(messages: LLMMessage[], opts: CompleteOptions = {}): Promise<string> {
    const wantsTemperature = opts.temperature !== undefined;

    const send = (withTemperature: boolean) =>
      this.client.chat.completions.create(
        {
          model: this.deployment,
          messages,
          temperature: withTemperature ? opts.temperature : undefined,
          max_completion_tokens: opts.maxTokens,
          response_format: opts.json ? { type: 'json_object' } : undefined
        },
        { signal: opts.signal }
      );

    let response;
    try {
      response = await send(wantsTemperature && this.supportsTemperature);
    } catch (err) {
      if (wantsTemperature && this.supportsTemperature && isUnsupportedTemperature(err)) {
        // Reasoning models only allow the default temperature; remember and retry.
        this.supportsTemperature = false;
        response = await send(false);
      } else {
        throw err;
      }
    }

    const content = response.choices[0]?.message?.content;
    if (content == null) throw new Error('Azure OpenAI returned no content');
    return content;
  }
}

function isUnsupportedTemperature(err: unknown): boolean {
  const e = err as { param?: string; code?: string; message?: string };
  const msg = e?.message ?? '';
  return (
    e?.param === 'temperature' ||
    (e?.code === 'unsupported_value' && /temperature/i.test(msg)) ||
    /temperature.*does not support/i.test(msg)
  );
}
