import { describe, it, expect } from 'vitest';
import { Runtime } from './runtime.js';
import type { Vagent, VagentHost } from './types.js';

/**
 * A tiny domain for testing the generic runtime:
 *  - Snapshot is the list of numbers appended so far.
 *  - Effects: append a number, spawn a child id, or withdraw self.
 */
type Snapshot = { values: number[] };
type Effect =
  | { kind: 'append'; value: number }
  | { kind: 'spawn'; id: string }
  | { kind: 'withdraw' };

function makeHost(
  factory: (id: string) => Vagent<Snapshot, Effect>,
  opts?: { complete?: (turn: number) => boolean }
) {
  const values: number[] = [];
  const applied: Array<{ turn: number; from: string; effect: Effect }> = [];
  let runtime: Runtime<Snapshot, Effect>;

  const host: VagentHost<Snapshot, Effect> = {
    snapshot: () => ({ values: [...values] }),
    activate: async (id) => factory(id),
    apply: (turn, effects) => {
      for (const { from, effect } of effects) {
        applied.push({ turn, from, effect });
        if (effect.kind === 'append') values.push(effect.value);
        else if (effect.kind === 'spawn') runtime.request(effect.id);
        else if (effect.kind === 'withdraw') runtime.withdraw(from);
      }
    },
    isComplete: opts?.complete
  };

  const bind = (r: Runtime<Snapshot, Effect>) => {
    runtime = r;
  };
  return { host, values, applied, bind };
}

describe('Runtime', () => {
  it('runs up to maxTurns and applies effects post-barrier', async () => {
    const { host, values, bind } = makeHost((id) => ({
      id,
      takeTurn: async (ctx) => [{ kind: 'append', value: ctx.turn }]
    }));
    const runtime = new Runtime(host, { maxTurns: 3, maxVagents: 5, concurrency: 2 });
    bind(runtime);
    runtime.request('a');
    const summary = await runtime.run();

    expect(summary.turnsRun).toBe(3);
    expect(summary.stoppedBecause).toBe('max-turns');
    expect(values).toEqual([1, 2, 3]);
  });

  it('gives every vagent the same snapshot within a turn (barrier semantics)', async () => {
    const seen: Record<string, number[]> = { a: [], b: [] };
    const { host, bind } = makeHost((id) => ({
      id,
      takeTurn: async (ctx) => {
        seen[id].push(ctx.snapshot.values.length);
        return [{ kind: 'append', value: 1 }];
      }
    }));
    const runtime = new Runtime(host, { maxTurns: 2, maxVagents: 5, concurrency: 2 });
    bind(runtime);
    runtime.request('a');
    runtime.request('b');
    await runtime.run();

    // Turn 1: both see empty (0). Turn 2: both see the 2 appended in turn 1.
    expect(seen.a).toEqual([0, 2]);
    expect(seen.b).toEqual([0, 2]);
  });

  it('defers spawned vagents to the next turn', async () => {
    const turnsSeen: Record<string, number[]> = {};
    const { host, bind } = makeHost((id) => ({
      id,
      takeTurn: async (ctx) => {
        (turnsSeen[id] ??= []).push(ctx.turn);
        if (id === 'root' && ctx.turn === 1) return [{ kind: 'spawn', id: 'child' }];
        return [];
      }
    }));
    const runtime = new Runtime(host, { maxTurns: 3, maxVagents: 5, concurrency: 2 });
    bind(runtime);
    runtime.request('root');
    await runtime.run();

    expect(turnsSeen.root).toEqual([1, 2, 3]);
    // child requested during turn 1 first acts on turn 2.
    expect(turnsSeen.child).toEqual([2, 3]);
  });

  it('enforces maxVagents and reports dropped requests', async () => {
    const { host, bind } = makeHost((id) => ({
      id,
      takeTurn: async () => []
    }));
    const runtime = new Runtime(host, { maxTurns: 1, maxVagents: 2, concurrency: 2 });
    bind(runtime);
    runtime.request('a');
    runtime.request('b');
    runtime.request('c'); // over the cap
    const summary = await runtime.run();

    expect(summary.activated.sort()).toEqual(['a', 'b']);
    expect(summary.droppedRequests).toEqual(['c']);
  });

  it('stops when all vagents withdraw', async () => {
    const { host, bind } = makeHost((id) => ({
      id,
      takeTurn: async () => [{ kind: 'withdraw' }]
    }));
    const runtime = new Runtime(host, { maxTurns: 10, maxVagents: 5, concurrency: 2 });
    bind(runtime);
    runtime.request('a');
    const summary = await runtime.run();

    expect(summary.turnsRun).toBe(1);
    expect(summary.stoppedBecause).toBe('no-active-vagents');
    expect(summary.withdrawn).toEqual(['a']);
  });

  it('stops early when host.isComplete returns true', async () => {
    const { host, bind } = makeHost(
      (id) => ({ id, takeTurn: async () => [] }),
      { complete: (turn) => turn === 2 }
    );
    const runtime = new Runtime(host, { maxTurns: 10, maxVagents: 5, concurrency: 2 });
    bind(runtime);
    runtime.request('a');
    const summary = await runtime.run();

    expect(summary.turnsRun).toBe(2);
    expect(summary.stoppedBecause).toBe('complete');
  });

  it('accumulates private memory across turns via remember()', async () => {
    const memories: number[] = [];
    const { host, bind } = makeHost((id) => ({
      id,
      takeTurn: async (ctx) => {
        memories.push(ctx.memory.length);
        ctx.remember(`turn-${ctx.turn}`);
        return [];
      }
    }));
    const runtime = new Runtime(host, { maxTurns: 3, maxVagents: 5, concurrency: 1 });
    bind(runtime);
    runtime.request('a');
    await runtime.run();

    expect(memories).toEqual([0, 1, 2]);
  });
});
