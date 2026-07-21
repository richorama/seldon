export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /** Request the model to return a single JSON object. */
  json?: boolean;
  signal?: AbortSignal;
}

/** A minimal, provider-agnostic chat-completion interface. */
export interface LLMProvider {
  readonly name: string;
  complete(messages: LLMMessage[], opts?: CompleteOptions): Promise<string>;
}
