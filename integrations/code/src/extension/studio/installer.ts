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

import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { coerce, satisfies, validRange } from "semver";

import type { Context } from "../context";
import { extract } from "./archive";
import {
  type StudioBinary,
  withStudioBinary
} from "./binary";
import {
  fetchArchive,
  fetchRelease,
  NetworkError,
  Release
} from "./fetch";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get the path to Zensical Studio, installing it if necessary.
 *
 * @param context - Context
 *
 * @returns Path to Zensical Studio or nothing
 */
export async function getInstalledStudioPath(
  context: Context,
): Promise<string | undefined> {
  const storage = path.join(context.getStorage(), "studio");

  // Try to fetch the latest release
  let release: Release | undefined;
  let networkError: NetworkError | undefined;
  try {
    release = await fetchRelease(context);
  } catch (error) {
    if (!(error instanceof NetworkError)) {
      throw error;
    }
    networkError = error;
  }

  // Check if the release is compatible with the extension
  if (
    typeof release !== "undefined" &&
    !(await checkRelease(context, release))
  ) {
    return;
  }

  // Get the installed Studio binary and install the release if necessary
  return withStudioBinary(
    storage,
    context.getState("version"),
    async (binary) => {
      if (typeof release === "undefined") {
        if (binary.exists) {
          if (typeof networkError !== "undefined") {
            context.log("Using installed Zensical Studio");
          }
          return binary.path;
        }
        if (typeof networkError !== "undefined") {
          throw networkError;
        }
        return;
      }

      // Check if we already have the latest version available
      if (binary.exists && binary.version === release.version) {
        return binary.path;
      }
      if (!(await installRelease(context, storage, binary, release))) {
        return;
      }
      context.setState("version", release.version);
      context.log("Installation completed");
      return binary.path;
    },
  );
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Install a Studio release from its archive.
 *
 * @param context - Context
 * @param storage - Installation directory
 * @param binary - Installed Studio binary
 * @param release - Release information
 *
 * @returns Whether the release was installed
 */
async function installRelease(
  context: Context, storage: string, binary: StudioBinary, release: Release,
): Promise<boolean> {
  let archive = "";
  let staging = "";
  let stage = "download";
  try {
    // Determine path to store the archive
    const { pathname } = new URL(release.url);
    archive = path.join(storage, path.basename(pathname));

    // Fetch archive and verify integrity
    const bytes = await fetchArchive(context, release);
    if (typeof bytes === "undefined") {
      return false;
    }
    stage = "integrity verification";
    context.log(`Installation: received ${bytes.byteLength} archive bytes`);
    if (!verify(bytes, release.integrity)) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      throw new Error(
        `Checksum mismatch: expected ${release.integrity}, received sha256-${digest}`,
      );
    }

    // Write and extract the downloaded archive
    stage = "archive write";
    await fs.writeFile(archive, bytes);
    stage = "extraction";
    staging = await fs.mkdtemp(path.join(storage, ".install-"));
    await extract(archive, staging);
    stage = "executable verification";
    const staged = path.join(staging, path.basename(binary.path));
    try {
      await fs.access(staged);
    } catch (error) {
      throw new Error("Zensical Studio not found in archive", { cause: error });
    }
    stage = "executable permissions";
    if (process.platform !== "win32") {
      await fs.chmod(staged, 0o755);
    }
    stage = "executable replacement";
    await binary.replace(staged, release.version);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    context.log(
      `Installation of ${release.version} failed during ${stage}: ${reason}`,
    );
    throw error;
  } finally {
    try {
      if (archive !== "") {
        await fs.rm(archive, { force: true });
      }
    } finally {
      if (staging !== "") {
        await fs.rm(staging, { force: true, recursive: true });
      }
    }
  }
}

/**
 * Check if the release is compatible with the current extension version.
 *
 * @param context - Context
 * @param release - Release information
 *
 * @returns Whether the release is compatible
 */
async function checkRelease(
  context: Context,
  release: Release,
): Promise<boolean> {
  const version = release.extension?.version;
  if (
    typeof version !== "undefined" &&
    !isCompatible(context.getVersion(), version)
  ) {
    const message =
      "Please update the Zensical Studio Extension to the latest version.";

    // Prompt the user to update the extension
    context.log(message);
    await context.promptUpdate(message);
    return false;
  }

  // Show message from the release if available
  const message = release.message;
  if (typeof message === "undefined") {
    return true;
  }

  // Log the message and show it to the user
  context.log(message.message);
  switch (message.kind) {
    case "error":
      context.showError(message.message);
      return false;
    case "warning":
      context.showWarning(message.message);
      break;
    case "info":
      context.showInfo(message.message);
      break;
  }
  return true;
}

/**
 * Check if the current version is compatible with the given constraint.
 *
 * @param current - Current version
 * @param constraint - Version constraint
 *
 * @returns Whether the current version is compatible
 */
function isCompatible(current: string, constraint: string): boolean {
  const version = coerce(current);
  if (version === null) {
    return false;
  }
  const range = validRange(constraint);
  if (range === null) {
    return false;
  }
  return satisfies(version, range);
}

/**
 * Verify the integrity of a file.
 *
 * @param bytes - File contents
 * @param integrity - Expected integrity hash
 *
 * @returns Whether the integrity matches
 */
function verify(bytes: Uint8Array, integrity: string): boolean {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `sha256-${digest}` === integrity;
}
