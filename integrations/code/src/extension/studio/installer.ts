/*
 * Copyright (c) 2026 Zensical and contributors
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

import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { coerce, satisfies, validRange } from "semver";

import type { Context } from "../context";
import { extract } from "./archive";
import { fetchArchive, fetchRelease, Release } from "./fetch";

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
export async function getStudioPathFromInstallation(
  context: Context,
): Promise<string | undefined> {
  let archive = "";
  try {
    const release = await fetchRelease(context);
    if (typeof release === "undefined") {
      return;
    }
    if (!(await checkRelease(context, release))) {
      return;
    }

    // Determine extension storage and ensure it exists
    const storage = path.join(context.getStorage(), "studio");
    await fs.mkdir(storage, { recursive: true });

    // Determine platform-specific executable path
    const executable = path.join(
      storage,
      process.platform === "win32" // fmt
        ? "zensical-studio.exe"
        : "zensical-studio",
    );

    // Check if we already have the latest version available
    const version = context.getState("version");
    if (existsSync(executable) && version === release.version) {
      return executable;
    }

    // Otherwise, determine path to store the archive
    const { pathname } = new URL(release.url);
    archive = path.join(storage, path.basename(pathname));

    // Fetch archive and verify integrity
    const bytes = await fetchArchive(context, release);
    if (typeof bytes === "undefined") {
      return;
    }
    if (!verify(bytes, release.integrity)) {
      context.log("Checksums don't match");
      return;
    }

    // Write and extract the downloaded archive
    await fs.writeFile(archive, bytes);
    await extract(archive, storage);
    if (!existsSync(executable)) {
      context.log("Zensical Studio not found in archive");
      return;
    }
    if (process.platform !== "win32") {
      await fs.chmod(executable, 0o755);
    }

    // Remember the installed version and return the executable
    context.setState("version", release.version);
    context.log("Installation completed");
    return executable;
  } finally {
    await fs.rm(archive, { force: true });
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Check if the release is compatible with the current extension version.
 *
 * @param context - Context
 * @param release - Release information
 *
 * @returns Whether the release is compatible
 */
export async function checkRelease(
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
