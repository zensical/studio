/*
 * Copyright (c) 2026 Zensical and contributors
 *
 * SPDX-License-Identifier: MIT
 * All contributions are certified under the DCO
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Recoverable Studio failure.
 */
export type RecoveryFailureKind = "availability" | "download" | "startup";

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/**
 * Number of failures before notifying the author or stopping bounded retries.
 */
const FAILURE_LIMIT = 3;

/**
 * Initial and maximum retry delays.
 */
const RETRY_DELAY = 5000;
const RETRY_DELAY_MAX = 5 * 60 * 1000;

/* ----------------------------------------------------------------------------
 * Class
 * ------------------------------------------------------------------------- */

/**
 * Studio recovery state.
 */
export class StudioRecovery {
  /** Failure attempts by kind. */
  private attempts = failureRecord();
  /** Failure awaiting a retry. */
  private pending: RecoveryFailureKind | undefined;
  /** Delay for the next retry. */
  private delay = RETRY_DELAY;
  /** Whether Studio is recovering from an unexpected process stop. */
  private recovering = false;

  /**
   * Record a failure and decide how recovery should continue.
   *
   * @param kind - Failure kind
   *
   * @returns Recovery decision
   */
  public fail(kind: RecoveryFailureKind) {
    const attempt = this.attempts[kind] + 1;
    const retry = kind === "availability" || attempt < FAILURE_LIMIT;
    const delay = this.delay;
    this.attempts[kind] = attempt;
    this.pending = retry ? kind : undefined;
    if (retry) {
      this.delay = Math.min(delay * 2, RETRY_DELAY_MAX);
    }
    return {
      attempt,
      delay,
      notify: attempt === FAILURE_LIMIT,
      retry,
    };
  }

  /**
   * Begin a scheduled or activity-triggered retry.
   *
   * @param onActivity - Whether editor activity triggered the retry
   *
   * @returns Whether recovery may retry
   */
  public retry(onActivity = false): boolean {
    if (
      typeof this.pending === "undefined" ||
      (onActivity && this.pending !== "availability")
    ) {
      return false;
    }
    this.pending = undefined;
    return true;
  }

  /**
   * Record successful runtime resolution.
   */
  public resolved(): void {
    this.attempts.availability = 0;
    this.attempts.download = 0;
    if (this.pending === "availability" || this.pending === "download") {
      this.pending = undefined;
    }
  }

  /**
   * Begin recovery from an unexpected process stop.
   *
   * @returns Whether the runtime should be resolved again
   */
  public beginRecovery(): boolean {
    if (this.recovering) {
      return false;
    }
    this.recovering = true;
    return true;
  }

  /**
   * Reset recovery after a manual restart or stable session.
   */
  public reset(): void {
    this.attempts = failureRecord();
    this.pending = undefined;
    this.delay = RETRY_DELAY;
    this.recovering = false;
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Create empty failure counters.
 *
 * @returns Failure counters
 */
function failureRecord(): Record<RecoveryFailureKind, number> {
  return {
    availability: 0,
    download: 0,
    startup: 0,
  };
}
