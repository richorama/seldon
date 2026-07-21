import type { CompleteOptions, LLMMessage, LLMProvider } from './provider.js';

export interface RecordedCall {
  messages: LLMMessage[];
  opts: CompleteOptions;
}

export type MockHandler = (
  messages: LLMMessage[],
  opts: CompleteOptions,
  callIndex: number
) => string;

/**
 * Deterministic provider for tests. Supply either a handler function (invoked
 * per call) or a fixed list of responses returned in order. All calls are
 * recorded on `calls` for assertions.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly calls: RecordedCall[] = [];
  private readonly handler: MockHandler;

  constructor(responsesOrHandler: string[] | MockHandler) {
    if (typeof responsesOrHandler === 'function') {
      this.handler = responsesOrHandler;
    } else {
      const responses = responsesOrHandler;
      this.handler = (_m, _o, i) => {
        if (i >= responses.length) {
          throw new Error(`MockProvider ran out of scripted responses at call ${i}`);
        }
        return responses[i];
      };
    }
  }

  async complete(messages: LLMMessage[], opts: CompleteOptions = {}): Promise<string> {
    const callIndex = this.calls.length;
    this.calls.push({ messages, opts });
    return this.handler(messages, opts, callIndex);
  }
}
