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

import * as fs from "node:fs";
import * as path from "node:path";

import type { Context } from "./context";
import { getStudio, type Studio } from "./studio";
import {
  AccessRejectedError,
  fetchRelease,
  getTransitionMessage,
  rememberTransitionMessage,
} from "./studio/fetch";

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/**
 * Native verifier allowance after a signed lease expires, in milliseconds.
 */
const CLOCK_ALLOWANCE = 60_000;

/* ----------------------------------------------------------------------------
 * Class
 * ------------------------------------------------------------------------- */

/**
 * Access resolution after Beta retirement or ordinary lease expiry.
 */
export class StudioTransition {
  /** Whether this controller has retired Beta */
  private retired = false;
  /** Whether a first-Free notification attempt is in progress */
  private notifying = false;
  /** Shared Beta retirement marker */
  private readonly marker: string;
  /** Shared Beta participation marker */
  private readonly participant: string;
  /** Shared first-Free notification claim */
  private readonly notice: string;

  /**
   * Create the access transition controller.
   *
   * @param context - Extension context
   */
  public constructor(private readonly context: Context) {
    this.marker = path.join(context.getStorage(), ".beta-ended");
    this.participant = path.join(context.getStorage(), ".beta-participant");
    this.notice = path.join(context.getStorage(), ".beta-free-notified");
  }

  /**
   * Check whether the server has retired Beta, including across windows.
   *
   * @returns Whether Beta access has permanently ended
   */
  public hasEnded(): boolean {
    return this.retired || fs.existsSync(this.marker);
  }

  /**
   * Compute the next access refresh deadline.
   *
   * Token claims are read only for scheduling. The native verifier remains
   * responsible for authorization.
   *
   * @param studio - Selected runtime, if available
   *
   * @returns Refresh deadline in Unix milliseconds, if one applies
   */
  public deadline(studio?: Studio): number | undefined {
    if (studio === undefined) {
      return undefined;
    }
    let expiration: number | undefined;
    if (studio.token !== undefined) {
      try {
        const payload = JSON.parse(
          Buffer.from(studio.token.split(".")[1], "base64url").toString(),
        );
        if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
          expiration = payload.exp * 1000 + CLOCK_ALLOWANCE;
        }
      } catch {
        // Invalid leases are rejected by native initialization.
      }
    }
    return expiration;
  }

  /**
   * Check whether the runtime needs refreshed access, including after sleep.
   *
   * @param studio - Selected runtime, if available
   *
   * @returns Whether access must be resolved again
   */
  public needsRefresh(studio?: Studio): boolean {
    if (studio?.edition === "beta" && this.hasEnded()) {
      return true;
    }
    const deadline = this.deadline(studio);
    return (
      studio !== undefined && deadline !== undefined && Date.now() >= deadline
    );
  }

  /**
   * Compute a bounded delay that stays within Node's maximum timer duration.
   *
   * @param studio - Selected runtime, if available
   *
   * @returns Delay in milliseconds until the next access check
   */
  public checkDelay(studio?: Studio): number {
    const deadline = this.deadline(studio);
    return Math.min(
      30_000,
      Math.max(1, (deadline ?? Date.now() + 30_000) - Date.now()),
    );
  }

  /**
   * Persist retirement before selecting Free, even if its download fails.
   */
  private async retire(): Promise<void> {
    // Preserve migration history before clearing the old token/replacing Beta.
    await this.rememberPriorBeta();
    this.retired = true;
    await fs.promises.mkdir(this.context.getStorage(), { recursive: true });
    try {
      await fs.promises.writeFile(this.marker, "", { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    await this.context.setState("token", undefined);
  }

  /**
   * Record old managed installations without treating metadata as access.
   */
  private async rememberPriorBeta(): Promise<void> {
    try {
      if (fs.existsSync(this.participant)) {
        return;
      }
      const storage = path.join(this.context.getStorage(), "studio");
      let edition: unknown;
      try {
        const value: unknown = JSON.parse(
          await fs.promises.readFile(
            path.join(storage, ".installation.json"), "utf8",
          ),
        );
        if (typeof value === "object" && value !== null && "edition" in value) {
          edition = value.edition;
        }
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" &&
          !(error instanceof SyntaxError)
        ) {
          throw error;
        }
      }
      if (edition === "free" || edition === "pro" || edition === "team") {
        return;
      }
      const executable = path.join(
        storage,
        process.platform === "win32"
          ? "zensical-studio.exe"
          : "zensical-studio",
      );
      const legacy = this.context.getState("edition") === "beta" ||
        (this.context.getState("edition") === undefined &&
         (this.context.getState("token") !== undefined ||
          (this.context.getState("version") !== undefined &&
           fs.existsSync(executable))));
      if ((edition === "beta" && fs.existsSync(executable)) || legacy) {
        await this.createMarker(this.participant);
      }
    } catch (error) {
      this.log(`Could not save beta participation: ${String(error)}`);
    }
  }

  /**
   * Record successful startup and offer the first-Free transition notice.
   *
   * @param studio - Successfully initialized runtime
   * @param isCurrent - Whether this runtime still owns the current startup
   */
  public async started(
    studio: Studio,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) {
      return;
    }
    try {
      if (studio.edition === "beta") {
        await this.createMarker(this.participant);
      } else if (
        studio.edition === "free" && this.hasEnded() &&
        fs.existsSync(this.participant) && !fs.existsSync(this.notice) &&
        !this.notifying
      ) {
        this.notifying = true;
        try {
          // Managed installs already retained the resolution response. Manual
          // paths and failed note requests can obtain it after Free is healthy.
          let message = getTransitionMessage(this.context);
          if (message === undefined) {
            const release = await fetchRelease(this.context, "free");
            if (release !== undefined) {
              await rememberTransitionMessage(this.context, release);
            }
            message = getTransitionMessage(this.context);
          }
          if (
            message === undefined || !isCurrent() ||
            !(await this.createMarker(this.notice))
          ) {
            return;
          }
          // Exclusive creation deduplicates across windows, restart and reload.
          if (!isCurrent()) {
            await fs.promises.unlink(this.notice);
            return;
          }
          try {
            // Capture this response's document without holding startup for
            // notification dismissal.
            void Promise.resolve(
              this.context.promptBetaTransition(message),
            ).catch(async error => {
              await this.releaseNotice(error);
            });
          } catch (error) {
            await this.releaseNotice(error);
          }
        } finally {
          this.notifying = false;
        }
      }
    } catch (error) {
      // Optional history/notification failures must not stop a healthy server.
      this.log(`Could not record Studio transition: ${String(error)}`);
    }
  }

  /**
   * Create an exclusive marker shared across windows and restarts.
   *
   * @param marker - Marker path
   *
   * @returns Whether this caller created the marker
   */
  private async createMarker(marker: string): Promise<boolean> {
    await fs.promises.mkdir(this.context.getStorage(), { recursive: true });
    try {
      await fs.promises.writeFile(marker, "", { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Log a transition event when the output channel is available.
   *
   * @param message - Message to log
   */
  private log(message: string): void {
    try {
      this.context.log(message);
    } catch {
      // The window may already be closing.
    }
  }

  /**
   * Release a notification claim after its presentation failed.
   *
   * @param error - Notification failure
   */
  private async releaseNotice(error: unknown): Promise<void> {
    this.log(`Could not show Studio transition: ${String(error)}`);
    try {
      await fs.promises.unlink(this.notice);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log(`Could not reset Studio transition notice: ${String(error)}`);
      }
    }
  }

  /**
   * Resolve runtime access after server retirement or ordinary lease expiry.
   *
   * @returns Selected runtime, or nothing if it is unavailable
   */
  public async resolve(): Promise<Studio | undefined> {
    if (!this.hasEnded()) {
      // A renewal denial may clear the last legacy participation evidence.
      await this.rememberPriorBeta();
      try {
        const studio = await getStudio(this.context);
        // Another window may record retirement while resolution is pending.
        if (!this.hasEnded()) {
          return this.needsRefresh(studio) ? undefined : studio;
        }
      } catch (error) {
        if (!(error instanceof AccessRejectedError) || error.status !== 410) {
          throw error;
        }
      }
    }
    await this.retire();
    return getStudio(this.context, { edition: "free" });
  }
}
