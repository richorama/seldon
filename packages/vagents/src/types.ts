/**
 * Core types for the generic virtual-agent (vagent) runtime.
 *
 * The runtime knows about *vagents* and *turns* — nothing about the host
 * application's domain. `Snapshot` is the read-only view handed to every vagent
 * each turn; `Effect` is the host-defined union a vagent emits.
 */

export type VagentId = string;

export interface VagentContext<Snapshot> {
  /** 1-based index of the current turn. */
  readonly turn: number;
  /** The id of the vagent taking this turn. */
  readonly self: VagentId;
  /** Read-only shared context for this turn (same for every vagent). */
  readonly snapshot: Snapshot;
  /** This vagent's private, append-only reasoning notes (runtime-owned). */
  readonly memory: readonly string[];
  /** Append a private reasoning note, visible to this vagent on later turns. */
  remember(note: string): void;
}

export interface Vagent<Snapshot, Effect> {
  readonly id: VagentId;
  /** Invoked once per turn while active. Returns effects to apply post-barrier. */
  takeTurn(ctx: VagentContext<Snapshot>): Promise<Effect[]>;
  /** Optional hook invoked when the vagent is deactivated (withdrawn). */
  onWithdraw?(): Promise<void>;
}

export interface RuntimeOptions {
  /** Hard cap on the number of turns. */
  maxTurns: number;
  /** Hard cap on the total number of vagents ever activated. */
  maxVagents: number;
  /** Maximum number of vagent turns executed in parallel. */
  concurrency: number;
}

/** An effect emitted by a vagent, tagged with its author. */
export interface AttributedEffect<Effect> {
  readonly from: VagentId;
  readonly effect: Effect;
}

/**
 * The host binds the generic runtime to a concrete domain: it builds snapshots,
 * applies effects, and materialises vagents on demand.
 */
export interface VagentHost<Snapshot, Effect> {
  /** Build the read-only snapshot handed to every vagent this turn. */
  snapshot(turn: number): Snapshot;
  /** Apply the effects collected after the turn's barrier. */
  apply(turn: number, effects: ReadonlyArray<AttributedEffect<Effect>>): void | Promise<void>;
  /** Factory: materialise a vagent for a freshly-requested id. */
  activate(id: VagentId): Promise<Vagent<Snapshot, Effect>>;
  /** Optional early-stop predicate evaluated after each turn. */
  isComplete?(turn: number): boolean;
}
