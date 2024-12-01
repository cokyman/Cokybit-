// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { JSONExt, PromiseDelegate } from '@phosphor/coreutils';

import { IDisposable } from '@phosphor/disposable';

import { ISignal, Signal } from '@phosphor/signaling';

/**
 * A readonly poll that calls an asynchronous function with each tick.
 *
 * @typeparam T - The resolved type of the factory's promises.
 * Defaults to `any`.
 *
 * @typeparam U - The rejected type of the factory's promises.
 * Defaults to `any`.
 */
export interface IPoll<T = any, U = any> {
  /**
   * A signal emitted when the poll is disposed.
   */
  readonly disposed: ISignal<this, void>;

  /**
   * The polling frequency data.
   */
  readonly frequency: IPoll.Frequency;

  /**
   * Whether the poll is disposed.
   */
  readonly isDisposed: boolean;

  /**
   * The name of the poll.
   */
  readonly name: string;

  /**
   * The poll state, which is the content of the currently-scheduled poll tick.
   */
  readonly state: IPoll.State<T, U>;

  /**
   * A promise that resolves when the currently-scheduled tick completes.
   *
   * #### Notes
   * Usually this will resolve after `state.interval` milliseconds from
   * `state.timestamp`. It can resolve earlier if the user starts or refreshes the
   * poll, etc.
   */
  readonly tick: Promise<IPoll<T, U>>;

  /**
   * A signal emitted when the poll state changes, i.e., a new tick is scheduled.
   */
  readonly ticked: ISignal<IPoll<T, U>, IPoll.State<T, U>>;
}

/**
 * A namespace for `IPoll` types.
 */
export namespace IPoll {
  /**
   * The polling frequency parameters.
   *
   * #### Notes
   * We implement the "decorrelated jitter" strategy from
   * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/.
   * Essentially, if consecutive retries are needed, we choose an integer:
   * `sleep = min(max, rand(interval, backoff * sleep))`
   * This ensures that the poll is never less than `interval`, and nicely
   * spreads out retries for consecutive tries. Over time, if (interval < max),
   * the random number will be above `max` about (1 - 1/backoff) of the time
   * (sleeping the `max`), and the rest of the time the sleep will be a random
   * number below `max`, decorrelating our trigger time from other pollers.
   */
  export type Frequency = {
    /**
     * Whether poll frequency backs off (boolean) or the backoff growth rate
     * (float > 1).
     *
     * #### Notes
     * If `true`, the default backoff growth rate is `3`.
     */
    readonly backoff: boolean | number;

    /**
     * The basic polling interval in milliseconds (integer).
     */
    readonly interval: number;

    /**
     * The maximum milliseconds (integer) between poll requests.
     */
    readonly max: number;
  };

  /**
   * The phase of the poll when the current tick was scheduled.
   */
  export type Phase =
    | 'constructed'
    | 'disposed'
    | 'reconnected'
    | 'refreshed'
    | 'rejected'
    | 'resolved'
    | 'standby'
    | 'started'
    | 'stopped'
    | 'when-rejected'
    | 'when-resolved';

  /**
   * Definition of poll state at any given time.
   *
   * @typeparam T - The resolved type of the factory's promises.
   * Defaults to `any`.
   *
   * @typeparam U - The rejected type of the factory's promises.
   * Defaults to `any`.
   */
  export type State<T = any, U = any> = {
    /**
     * The number of milliseconds until the current tick resolves.
     */
    readonly interval: number;

    /**
     * The payload of the last poll resolution or rejection.
     *
     * #### Notes
     * The payload is `null` unless the `phase` is `'reconnected`, `'resolved'`,
     * or `'rejected'`. Its type is `T` for resolutions and `U` for rejections.
     */
    readonly payload: T | U | null;

    /**
     * The current poll phase.
     */
    readonly phase: Phase;

    /**
     * The timestamp for when this tick was scheduled.
     */
    readonly timestamp: number;
  };
}

/**
 * A class that wraps an asynchronous function to poll at a regular interval
 * with exponential increases to the interval length if the poll fails.
 *
 * @typeparam T - The resolved type of the factory's promises.
 * Defaults to `any`.
 *
 * @typeparam U - The rejected type of the factory's promises.
 * Defaults to `any`.
 */
export class Poll<T = any, U = any> implements IDisposable, IPoll<T, U> {
  /**
   * Instantiate a new poll with exponential backoff in case of failure.
   *
   * @param options - The poll instantiation options.
   */
  constructor(options: Poll.IOptions<T, U>) {
    this._factory = options.factory;
    this._standby = options.standby || Private.DEFAULT_STANDBY;
    this._state = { ...Private.DEFAULT_STATE, timestamp: new Date().getTime() };

    this.frequency = {
      ...Private.DEFAULT_FREQUENCY,
      ...(options.frequency || {})
    };
    this.name = options.name || Private.DEFAULT_NAME;

    // Schedule poll ticks after `when` promise is settled.
    (options.when || Promise.resolve())
      .then(_ => {
        if (this.isDisposed) {
          return;
        }

        return this.schedule({
          interval: Private.IMMEDIATE,
          phase: 'when-resolved'
        });
      })
      .catch(reason => {
        if (this.isDisposed) {
          return;
        }

        console.warn(`Poll (${this.name}) started despite rejection.`, reason);

        return this.schedule({
          interval: Private.IMMEDIATE,
          phase: 'when-rejected'
        });
      });
  }

  /**
   * The name of the poll.
   */
  readonly name: string;

  /**
   * A signal emitted when the poll is disposed.
   */
  get disposed(): ISignal<this, void> {
    return this._disposed;
  }

  /**
   * The polling frequency parameters.
   */
  get frequency(): IPoll.Frequency {
    return this._frequency;
  }
  set frequency(frequency: IPoll.Frequency) {
    if (this.isDisposed || JSONExt.deepEqual(frequency, this.frequency || {})) {
      return;
    }

    let { backoff, interval, max } = frequency;

    interval = Math.round(interval);
    max = Math.round(max);

    if (typeof backoff === 'number' && backoff < 1) {
      throw new Error('Poll backoff growth factor must be at least 1');
    }

    if (interval < 0 || interval > max) {
      throw new Error('Poll interval must be between 0 and max');
    }

    if (max > Poll.MAX_INTERVAL) {
      throw new Error(`Max interval must be less than ${Poll.MAX_INTERVAL}`);
    }

    this._frequency = { backoff, interval, max };
  }

  /**
   * Whether the poll is disposed.
   */
  get isDisposed(): boolean {
    return this.state.phase === 'disposed';
  }

  /**
   * Indicates when the poll switches to standby.
   */
  get standby(): Poll.Standby | (() => boolean | Poll.Standby) {
    return this._standby;
  }
  set standby(standby: Poll.Standby | (() => boolean | Poll.Standby)) {
    if (this.isDisposed || this.standby === standby) {
      return;
    }

    this._standby = standby;
  }

  /**
   * The poll state, which is the content of the current poll tick.
   */
  get state(): IPoll.State<T, U> {
    return this._state;
  }

  /**
   * A promise that resolves when the poll next ticks.
   */
  get tick(): Promise<this> {
    return this._tick.promise;
  }

  /**
   * A signal emitted when the poll ticks and fires off a new request.
   */
  get ticked(): ISignal<this, IPoll.State<T, U>> {
    return this._ticked;
  }

  /**
   * Dispose the poll.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this._state = {
      ...Private.DISPOSED_STATE,
      timestamp: new Date().getTime()
    };
    this._tick.promise.catch(_ => undefined);
    this._tick.reject(new Error(`Poll (${this.name}) is disposed.`));
    this._disposed.emit();
    Signal.clearData(this);
  }

  /**
   * Refreshes the poll. Schedules `refreshed` tick if necessary.
   *
   * @returns A promise that resolves after tick is scheduled and never rejects.
   */
  refresh(): Promise<void> {
    return this.schedule({
      cancel: last => last.phase === 'refreshed',
      interval: Private.IMMEDIATE,
      phase: 'refreshed'
    });
  }

  /**
   * Starts the poll. Schedules `started` tick if necessary.
   *
   * @returns A promise that resolves after tick is scheduled and never rejects.
   */
  start(): Promise<void> {
    return this.schedule({
      cancel: last => last.phase !== 'standby' && last.phase !== 'stopped',
      interval: Private.IMMEDIATE,
      phase: 'started'
    });
  }

  /**
   * Stops the poll. Schedules `stopped` tick if necessary.
   *
   * @returns A promise that resolves after tick is scheduled and never rejects.
   */
  stop(): Promise<void> {
    return this.schedule({
      cancel: last => last.phase === 'stopped',
      interval: Private.NEVER,
      phase: 'stopped'
    });
  }

  /**
   * Schedule the next poll tick.
   *
   * @param next - The next poll state data to schedule. Defaults to standby.
   *
   * @param next.cancel - Cancels state transition if function returns `true`.
   *
   * @returns A promise that resolves when the next poll state is active.
   *
   * #### Notes
   * This method is protected to allow sub-classes to implement methods that can
   * schedule poll ticks.
   */
  protected async schedule(
    next: Partial<IPoll.State & { cancel: (last: IPoll.State) => boolean }> = {}
  ): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    // The `when` promise in the constructor options acts as a gate.
    if (this.state.phase === 'constructed') {
      if (next.phase !== 'when-rejected' && next.phase !== 'when-resolved') {
        await this.tick;
      }
    }

    // Check if the phase transition should be canceled.
    if (next.cancel && next.cancel(this.state)) {
      return;
    }

    // Update poll state.
    const last = this.state;
    const pending = this._tick;
    const scheduled = new PromiseDelegate<this>();
    const state: IPoll.State<T, U> = {
      interval: this.frequency.interval,
      payload: null,
      phase: 'standby',
      timestamp: new Date().getTime(),
      ...next
    };
    this._state = state;
    this._tick = scheduled;

    // Clear the schedule if possible.
    if (last.interval === Private.IMMEDIATE) {
      cancelAnimationFrame(this._timeout);
    } else {
      clearTimeout(this._timeout);
    }

    // Emit ticked signal, resolve pending promise, and await its settlement.
    this._ticked.emit(this.state);
    pending.resolve(this);
    await pending.promise;

    // Schedule next execution and cache its timeout handle.
    const execute = () => {
      if (this.isDisposed || this.tick !== scheduled.promise) {
        return;
      }

      this._execute();
    };
    this._timeout =
      state.interval === Private.IMMEDIATE
        ? requestAnimationFrame(execute)
        : state.interval === Private.NEVER
        ? -1
        : setTimeout(execute, state.interval);
  }

  /**
   * Execute a new poll factory promise or stand by if necessary.
   */
  private _execute(): void {
    let standby =
      typeof this.standby === 'function' ? this.standby() : this.standby;
    standby =
      standby === 'never'
        ? false
        : standby === 'when-hidden'
        ? !!(typeof document !== 'undefined' && document && document.hidden)
        : true;

    // If in standby mode schedule next tick without calling the factory.
    if (standby) {
      void this.schedule();
      return;
    }

    const pending = this.tick;

    this._factory(this.state)
      .then((resolved: T) => {
        if (this.isDisposed || this.tick !== pending) {
          return;
        }

        void this.schedule({
          payload: resolved,
          phase: this.state.phase === 'rejected' ? 'reconnected' : 'resolved'
        });
      })
      .catch((rejected: U) => {
        if (this.isDisposed || this.tick !== pending) {
          return;
        }

        void this.schedule({
          interval: Private.sleep(this.frequency, this.state),
          payload: rejected,
          phase: 'rejected'
        });
      });
  }

  private _disposed = new Signal<this, void>(this);
  private _factory: Poll.Factory<T, U>;
  private _frequency: IPoll.Frequency;
  private _standby: Poll.Standby | (() => boolean | Poll.Standby);
  private _state: IPoll.State<T, U>;
  private _tick = new PromiseDelegate<this>();
  private _ticked = new Signal<this, IPoll.State<T, U>>(this);
  private _timeout = -1;
}

/**
 * A namespace for `Poll` types, interfaces, and statics.
 */
export namespace Poll {
  /**
   * A promise factory that returns an individual poll request.
   *
   * @typeparam T - The resolved type of the factory's promises.
   *
   * @typeparam U - The rejected type of the factory's promises.
   */
  export type Factory<T, U> = (state: IPoll.State<T, U>) => Promise<T>;

  /**
   * Indicates when the poll switches to standby.
   */
  export type Standby = 'never' | 'when-hidden';

  /**
   * Instantiation options for polls.
   *
   * @typeparam T - The resolved type of the factory's promises.
   * Defaults to `any`.
   *
   * @typeparam U - The rejected type of the factory's promises.
   * Defaults to `any`.
   */
  export interface IOptions<T = any, U = any> {
    /**
     * A factory function that is passed a poll tick and returns a poll promise.
     */
    factory: Factory<T, U>;

    /**
     * The polling frequency parameters.
     */
    frequency?: Partial<IPoll.Frequency>;

    /**
     * The name of the poll.
     * Defaults to `'unknown'`.
     */
    name?: string;

    /**
     * Indicates when the poll switches to standby or a function that returns
     * a boolean or a `Poll.Standby` value to indicate whether to stand by.
     * Defaults to `'when-hidden'`.
     *
     * #### Notes
     * If a function is passed in, for any given context, it should be
     * idempotent and safe to call multiple times. It will be called before each
     * tick execution, but may be called by clients as well.
     */
    standby?: Standby | (() => boolean | Standby);

    /**
     * If set, a promise which must resolve (or reject) before polling begins.
     */
    when?: Promise<any>;
  }

  /**
   * Delays are 32-bit integers in many browsers so intervals need to be capped.
   *
   * #### Notes
   * https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout#Maximum_delay_value
   */
  export const MAX_INTERVAL = 2147483647;
}

/**
 * A namespace for private module data.
 */
namespace Private {
  /**
   * An interval value that indicates the poll should tick immediately.
   */
  export const IMMEDIATE = 0;

  /**
   * An interval value that indicates the poll should never tick.
   */
  export const NEVER = Infinity;

  /**
   * The default backoff growth rate if `backoff` is `true`.
   */
  export const DEFAULT_BACKOFF = 3;

  /**
   * The default polling frequency.
   */
  export const DEFAULT_FREQUENCY: IPoll.Frequency = {
    backoff: true,
    interval: 1000,
    max: 30 * 1000
  };

  /**
   * The default poll name.
   */
  export const DEFAULT_NAME = 'unknown';

  /**
   * The default poll standby behavior.
   */
  export const DEFAULT_STANDBY: Poll.Standby = 'when-hidden';

  /**
   * The first poll tick state's default values superseded in constructor.
   */
  export const DEFAULT_STATE: IPoll.State = {
    interval: NEVER,
    payload: null,
    phase: 'constructed',
    timestamp: new Date(0).getTime()
  };

  /**
   * The disposed tick state values.
   */
  export const DISPOSED_STATE: IPoll.State = {
    interval: NEVER,
    payload: null,
    phase: 'disposed',
    timestamp: new Date(0).getTime()
  };

  /**
   * Get a random integer between min and max, inclusive of both.
   *
   * #### Notes
   * From
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random#Getting_a_random_integer_between_two_values_inclusive
   *
   * From the MDN page: It might be tempting to use Math.round() to accomplish
   * that, but doing so would cause your random numbers to follow a non-uniform
   * distribution, which may not be acceptable for your needs.
   */
  function getRandomIntInclusive(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Returns the number of milliseconds to sleep before the next tick.
   *
   * @param frequency - The poll's base frequency.
   * @param last - The poll's last tick.
   */
  export function sleep(frequency: IPoll.Frequency, last: IPoll.State): number {
    const { backoff, interval, max } = frequency;
    const growth =
      backoff === true ? DEFAULT_BACKOFF : backoff === false ? 1 : backoff;
    const random = getRandomIntInclusive(interval, last.interval * growth);

    return Math.min(max, random);
  }
}
