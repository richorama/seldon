import { mapWithConcurrency } from './scheduler.js';
import type {
  AttributedEffect,
  RuntimeOptions,
  Vagent,
  VagentContext,
  VagentHost,
  VagentId
} from './types.js';

interface Activation<Snapshot, Effect> {
  vagent: Vagent<Snapshot, Effect>;
  memory: string[];
  /** Turn on which the vagent becomes eligible to take turns. */
  activeFromTurn: number;
  withdrawn: boolean;
}

export interface RuntimeSummary {
  turnsRun: number;
  activated: string[];
  withdrawn: string[];
  droppedRequests: string[];
  stoppedBecause: 'max-turns' | 'no-active-vagents' | 'complete';
}

/**
 * Drives a bounded, barrier-synchronised, turn-based deliberation over a set of
 * on-demand virtual agents (vagents).
 *
 * Semantics:
 *  - Requests to activate are queued; a request made during turn N activates the
 *    vagent for turn N+1 (so newcomers observe the context before contributing).
 *  - `maxVagents` caps total activations; excess requests are dropped and reported.
 *  - Within a turn every active vagent sees the *same* snapshot; effects are
 *    applied only after all vagents have taken their turn (post-barrier).
 *  - The loop stops at `maxTurns`, when no vagents are active, or when
 *    `host.isComplete(turn)` returns true.
 */
export class Runtime<Snapshot, Effect> {
  private readonly host: VagentHost<Snapshot, Effect>;
  private readonly opts: RuntimeOptions;
  private readonly activations = new Map<VagentId, Activation<Snapshot, Effect>>();
  private readonly pending = new Set<VagentId>();
  private readonly dropped: string[] = [];

  constructor(host: VagentHost<Snapshot, Effect>, opts: RuntimeOptions) {
    if (opts.maxTurns < 1) throw new Error('maxTurns must be >= 1');
    if (opts.maxVagents < 1) throw new Error('maxVagents must be >= 1');
    if (opts.concurrency < 1) throw new Error('concurrency must be >= 1');
    this.host = host;
    this.opts = opts;
  }

  /**
   * Request activation of a vagent by id. Idempotent; respects `maxVagents`.
   * Returns true if the request was accepted (already known counts as accepted),
   * false if it was dropped because the cap is reached.
   */
  request(id: VagentId): boolean {
    if (this.activations.has(id) || this.pending.has(id)) return true;
    if (this.totalKnown() >= this.opts.maxVagents) {
      this.dropped.push(id);
      return false;
    }
    this.pending.add(id);
    return true;
  }

  /** Number of currently active (non-withdrawn, eligible) vagents. */
  activeCount(turn: number): number {
    return this.activeIds(turn).length;
  }

  async run(): Promise<RuntimeSummary> {
    let turnsRun = 0;
    let stoppedBecause: RuntimeSummary['stoppedBecause'] = 'max-turns';

    for (let turn = 1; turn <= this.opts.maxTurns; turn++) {
      await this.materialisePending(turn);
      const active = this.activeIds(turn);

      if (active.length === 0) {
        stoppedBecause = 'no-active-vagents';
        break;
      }

      turnsRun = turn;
      const snapshot = this.host.snapshot(turn);

      const perVagentEffects = await mapWithConcurrency(active, this.opts.concurrency, (id) =>
        this.runTurn(id, turn, snapshot)
      );

      const effects: AttributedEffect<Effect>[] = [];
      for (const attributed of perVagentEffects) effects.push(...attributed);
      await this.host.apply(turn, effects);

      if (this.host.isComplete?.(turn)) {
        stoppedBecause = 'complete';
        break;
      }
      if (this.activeIds(turn + 1).length === 0 && this.pending.size === 0) {
        stoppedBecause = 'no-active-vagents';
        break;
      }
    }

    return {
      turnsRun,
      activated: [...this.activations.keys()],
      withdrawn: [...this.activations.values()].filter((a) => a.withdrawn).map((a) => a.vagent.id),
      droppedRequests: [...new Set(this.dropped)],
      stoppedBecause
    };
  }

  /** Mark a vagent as withdrawn; it will not take further turns. */
  withdraw(id: VagentId): void {
    const activation = this.activations.get(id);
    if (activation) activation.withdrawn = true;
  }

  private async runTurn(
    id: VagentId,
    turn: number,
    snapshot: Snapshot
  ): Promise<AttributedEffect<Effect>[]> {
    const activation = this.activations.get(id)!;
    const ctx: VagentContext<Snapshot> = {
      turn,
      self: id,
      snapshot,
      memory: activation.memory,
      remember: (note: string) => {
        activation.memory.push(note);
      }
    };
    const effects = await activation.vagent.takeTurn(ctx);
    return effects.map((effect) => ({ from: id, effect }));
  }

  private async materialisePending(turn: number): Promise<void> {
    if (this.pending.size === 0) return;
    const ids = [...this.pending];
    this.pending.clear();
    for (const id of ids) {
      const vagent = await this.host.activate(id);
      this.activations.set(id, {
        vagent,
        memory: [],
        activeFromTurn: turn,
        withdrawn: false
      });
    }
  }

  private activeIds(turn: number): VagentId[] {
    const ids: VagentId[] = [];
    for (const [id, a] of this.activations) {
      if (!a.withdrawn && a.activeFromTurn <= turn) ids.push(id);
    }
    return ids;
  }

  private totalKnown(): number {
    return this.activations.size + this.pending.size;
  }
}
