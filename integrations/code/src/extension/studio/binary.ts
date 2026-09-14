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

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/**
 * Current binary storage revision.
 */
const BINARY_REVISION = 1;

/**
 * Maximum time to wait for another binary transaction.
 */
const BINARY_LOCK_TIMEOUT = 120_000;

/**
 * Grace period for a lock whose owner has not been recorded yet.
 */
const BINARY_LOCK_GRACE = 5_000;

/**
 * Delay between binary lock attempts.
 */
const BINARY_LOCK_RETRY_DELAY = 100;

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Installed Studio binary.
 */
export interface StudioBinary {
  /**
   * Whether the binary exists.
   */
  readonly exists: boolean;

  /**
   * Path to the binary.
   */
  readonly path: string;

  /**
   * Installed version.
   */
  readonly version?: string;

  /**
   * Replace the binary with a staged version.
   *
   * @param source - Staged binary
   * @param version - Version of staged binary
   */
  replace(
    source: string,
    version: string,
  ): Promise<void>;
}

/**
 * Binary state persisted with the executable.
 */
interface BinaryState {
  /**
   * Binary storage revision.
   */
  revision?: number;

  /**
   * Installed version.
   */
  version?: string;
}

/**
 * Binary lock owner.
 */
interface BinaryLockOwner {
  /**
   * Process identifier.
   */
  pid: number;

  /**
   * Unique ownership token.
   */
  token: string;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Open the installed Studio binary for an exclusive transaction.
 *
 * @param storage - Binary storage directory
 * @param legacyVersion - Version from legacy extension state
 * @param operation - Operation to run
 *
 * @returns Result of operation
 */
export async function withStudioBinary<T>(
  storage: string,
  legacyVersion: string | undefined,
  operation: (binary: StudioBinary) => Promise<T>,
): Promise<T> {
  await fs.mkdir(storage, { recursive: true });
  return withBinaryLock(storage, async () => {
    const executable = path.join(
      storage,
      process.platform === "win32" // fmt
        ? "zensical-studio.exe"
        : "zensical-studio",
    );
    const state = await readBinaryState(storage);
    let changed = false;
    if (typeof state.version === "undefined" && legacyVersion !== undefined) {
      state.version = legacyVersion;
      changed = true;
    }
    if (state.revision !== BINARY_REVISION) {
      // Give binaries installed before atomic replacement a fresh identity.
      if (process.platform === "darwin" && existsSync(executable)) {
        await refreshExecutableInode(executable);
      }
      state.revision = BINARY_REVISION;
      changed = true;
    }
    if (changed) {
      await writeBinaryState(storage, state);
    }

    return operation({
      get exists() {
        return existsSync(executable);
      },
      path: executable,
      get version() {
        return state.version;
      },
      async replace(
        source: string,
        version: string,
      ) {
        await replaceExecutable(source, executable);
        state.revision = BINARY_REVISION;
        state.version = version;
        await writeBinaryState(storage, state);
      },
    });
  });
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Reinstall an executable's current bytes under a fresh inode.
 *
 * @param target - Installed executable
 */
async function refreshExecutableInode(target: string): Promise<void> {
  const directory = await fs.mkdtemp(
    path.join(path.dirname(target), ".migrate-"),
  );
  const staged = path.join(directory, path.basename(target));
  try {
    await fs.copyFile(target, staged);
    await fs.chmod(staged, 0o755);
    await replaceExecutable(staged, target);
  } finally {
    await fs.rm(directory, { force: true, recursive: true });
  }
}

/**
 * Read the persisted binary state.
 *
 * @param storage - Binary storage directory
 *
 * @returns Binary state
 */
async function readBinaryState(
  storage: string,
): Promise<BinaryState> {
  try {
    const value: unknown = JSON.parse(
      await fs.readFile(path.join(storage, ".installation.json"), "utf8"),
    );
    if (typeof value !== "object" || value === null) {
      return {};
    }
    return {
      ...("revision" in value && typeof value.revision === "number"
        ? { revision: value.revision }
        : {}),
      ...("version" in value && typeof value.version === "string"
        ? { version: value.version }
        : {}),
    };
  } catch (error) {
    if (isErrorCode(error, "ENOENT") || error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

/**
 * Persist the binary state.
 *
 * @param storage - Binary storage directory
 * @param state - Binary state
 */
async function writeBinaryState(
  storage: string,
  state: BinaryState,
): Promise<void> {
  await fs.writeFile(
    path.join(storage, ".installation.json"),
    `${JSON.stringify(state)}\n`,
  );
}

/**
 * Run an operation while holding the binary lock.
 *
 * @param storage - Binary storage directory
 * @param operation - Operation to run
 *
 * @returns Result of operation
 */
async function withBinaryLock<T>(
  storage: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = path.join(storage, ".install.lock");
  const owner = { pid: process.pid, token: randomUUID() };
  const started = Date.now();
  while (!(await createBinaryLock(lock, owner))) {
    if (await removeStaleBinaryLock(lock)) {
      continue;
    }
    if (Date.now() - started >= BINARY_LOCK_TIMEOUT) {
      throw new Error("Timed out waiting for another Studio update");
    }
    await delay(BINARY_LOCK_RETRY_DELAY);
  }

  try {
    return await operation();
  } finally {
    await releaseBinaryLock(lock, owner);
  }
}

/**
 * Replace the installed executable without overwriting its existing inode.
 *
 * @param source - Staged executable
 * @param target - Installed executable
 */
async function replaceExecutable(
  source: string,
  target: string,
): Promise<void> {
  if (process.platform !== "win32") {
    await fs.rename(source, target);
    return;
  }

  // Windows cannot atomically replace an existing executable with rename.
  const backup = `${target}.previous`;
  if (!existsSync(target) && existsSync(backup)) {
    await fs.rename(backup, target);
  } else {
    await fs.rm(backup, { force: true });
  }

  const previous = existsSync(target);
  if (previous) {
    await fs.rename(target, backup);
  }
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (previous && !existsSync(target)) {
      await fs.rename(backup, target);
    }
    throw error;
  }
  await fs.rm(backup, { force: true });
}

/**
 * Create a binary lock.
 *
 * @param lock - Binary lock path
 * @param owner - Binary lock owner
 *
 * @returns Whether the lock was created
 */
async function createBinaryLock(
  lock: string,
  owner: BinaryLockOwner,
): Promise<boolean> {
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      return false;
    }
    throw error;
  }

  try {
    await fs.writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify(owner),
    );
    return true;
  } catch (error) {
    await fs.rm(lock, { force: true, recursive: true });
    throw error;
  }
}

/**
 * Remove a binary lock whose process no longer exists.
 *
 * @param lock - Binary lock path
 *
 * @returns Whether no active lock remains
 */
async function removeStaleBinaryLock(lock: string): Promise<boolean> {
  const owner = await readBinaryLockOwner(lock);
  if (typeof owner !== "undefined" && isProcessAlive(owner.pid)) {
    return false;
  }
  if (typeof owner === "undefined") {
    try {
      const status = await fs.stat(lock);
      if (Date.now() - status.mtimeMs < BINARY_LOCK_GRACE) {
        return false;
      }
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return true;
      }
      throw error;
    }
  }

  const stale = `${lock}.stale-${randomUUID()}`;
  try {
    await fs.rename(lock, stale);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return true;
    }
    throw error;
  }
  await fs.rm(stale, { force: true, recursive: true });
  return true;
}

/**
 * Release a binary lock if it is still owned by this process.
 *
 * @param lock - Binary lock path
 * @param owner - Binary lock owner
 */
async function releaseBinaryLock(
  lock: string,
  owner: BinaryLockOwner,
): Promise<void> {
  const current = await readBinaryLockOwner(lock);
  if (current?.token !== owner.token) {
    return;
  }

  const released = `${lock}.released-${owner.token}`;
  try {
    await fs.rename(lock, released);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  await fs.rm(released, { force: true, recursive: true });
}

/**
 * Read the owner of a binary lock.
 *
 * @param lock - Binary lock path
 *
 * @returns Binary lock owner or nothing
 */
async function readBinaryLockOwner(
  lock: string,
): Promise<BinaryLockOwner | undefined> {
  try {
    const value: unknown = JSON.parse(
      await fs.readFile(path.join(lock, "owner.json"), "utf8"),
    );
    if (
      typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      typeof value.pid === "number" &&
      "token" in value &&
      typeof value.token === "string"
    ) {
      return { pid: value.pid, token: value.token };
    }
  } catch (error) {
    if (!isErrorCode(error, "ENOENT") && !(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return undefined;
}

/**
 * Check whether a process is still running.
 *
 * @param pid - Process identifier
 *
 * @returns Whether the process is still running
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorCode(error, "EPERM");
  }
}

/**
 * Wait for the given duration.
 *
 * @param timeout - Duration in milliseconds
 *
 * @returns Promise that resolves after the duration
 */
function delay(timeout: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

/**
 * Check whether an error has the given filesystem error code.
 *
 * @param error - Error
 * @param code - Filesystem error code
 *
 * @returns Whether the error has the given code
 */
function isErrorCode(
  error: unknown,
  code: string,
): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === code
  );
}
