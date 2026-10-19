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
  type StudioInstallation,
  type StudioEdition,
  withStudioBinary,
} from "./binary";
import {
  fetchArchive,
  fetchRelease,
  NetworkError,
  type Release,
  rememberTransitionMessage,
} from "./fetch";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get the executable and recorded version, installing it if necessary.
 *
 * @param context - Context
 * @param edition - Studio edition
 *
 * @returns Installed executable or nothing
 */
export async function getInstalledStudio(
  context: Context,
  edition: StudioEdition = "beta",
): Promise<{ path: string; version?: string } | undefined> {
  const storage = path.join(context.getStorage(), "studio");

  // Try to fetch the latest release
  let release: Release | undefined;
  let networkError: NetworkError | undefined;
  try {
    release = await fetchRelease(context, edition);
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

  // Older delivery responses omit edition and describe beta. Reject unknown
  // identities before they can be installed or persisted as a cache hit.
  const installation = release === undefined
    ? undefined
    : releaseIdentity(release);
  if (installation !== undefined && installation.edition !== edition) {
    throw new Error(
      "Zensical Studio release does not match the selected edition",
    );
  }

  // Remember the transition message for the release if available
  if (release !== undefined) {
    await rememberTransitionMessage(context, release);
  }

  // Get the installed Studio binary and install the release if necessary
  return withStudioBinary(
    storage,
    context.getState("version"),
    async (binary) => {
      if (release === undefined || installation === undefined) {
        const legacyBeta = edition === "beta" &&
          binary.installation === undefined &&
          binary.edition === undefined &&
          binary.version !== undefined &&
          (
            context.getState("edition") === undefined ||
            context.getState("edition") === "beta"
          );
        if (
          binary.exists && (
            binary.installation?.edition === edition || legacyBeta
          )
        ) {
          if (typeof networkError !== "undefined") {
            context.log("Using installed Zensical Studio");
          }
          return { path: binary.path, version: binary.version };
        }
        if (typeof networkError !== "undefined") {
          throw networkError;
        }
        return;
      }

      // Check if we already have the latest version available
      const installed = binary.installation;
      if (
        binary.exists && installed !== undefined &&
        installed.version === installation.version &&
        installed.edition === installation.edition &&
        installed.integrity === installation.integrity
      ) {
        return { path: binary.path, version: binary.version };
      }
      if (!(await installRelease(
        context, storage, binary, release, installation,
      ))) {
        return;
      }
      context.setState("version", release.version);
      context.setState("edition", installation.edition);
      context.log("Installation completed");
      return { path: binary.path, version: binary.version };
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
 * @param installation - Verified release identity
 *
 * @returns Whether the release was installed
 */
async function installRelease(
  context: Context,
  storage: string,
  binary: StudioBinary,
  release: Release,
  installation: StudioInstallation,
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
    if (!verify(bytes, installation.integrity)) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      throw new Error(
        `Checksum mismatch: expected ${release.integrity}, ` +
          `received sha256-${digest}`,
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
    await binary.replace(staged, installation);
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
 * Return the complete identity of a release, including legacy beta responses.
 *
 * @param release - Release information
 *
 * @returns Complete release identity
 */
function releaseIdentity(release: Release): StudioInstallation {
  const edition = release.edition === undefined ? "beta" : release.edition;
  if (
    (
      edition !== "beta" && edition !== "free" &&
      edition !== "pro" && edition !== "team"
    ) ||
    typeof release.version !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(release.version) ||
    typeof release.integrity !== "string" ||
    !/^sha256-[a-f0-9]{64}$/i.test(release.integrity)
  ) {
    throw new Error("Invalid Zensical Studio release identity");
  }
  return {
    edition,
    version: release.version,
    integrity: release.integrity.toLowerCase(),
  };
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
  if (
    typeof message !== "object" || message === null ||
    typeof message.message !== "string"
  ) {
    return true;
  }

  // Free information belongs to the validated post-startup notice path.
  if (release.edition === "free" && message.kind === "info") {
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
