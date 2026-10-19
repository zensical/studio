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
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Context } from "./context";
import { getInstalledStudio } from "./studio/installer";
import { getToken } from "./studio/token";
import {
  AccessRejectedError,
  fetchRelease,
  NetworkError,
  type Release,
} from "./studio/fetch";
import { readAccess, rememberAccess } from "./studio/access";
import type {
  StudioEdition,
  StudioInstallation,
} from "./studio/binary";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Zensical Studio configuration.
 */
export interface Studio {
  /** Path to Zensical Studio */
  path: string;
  /** Selected runtime edition */
  edition: StudioEdition;
  /** Expected executable version, when known */
  version?: string;
  /** Whether Free was selected from a configured executable */
  local?: boolean;
  /** Startup lease when required by the runtime */
  token?: string;
  /** Whether public access followed an unsuccessful license check */
  license?: {
    error: boolean;
  };
}

/** Legacy public-edition hint; the server selects the actual edition. */
export interface StudioAccess {
  edition: "beta" | "free";
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get Zensical Studio configuration.
 *
 * @param context - Context
 * @param access - Legacy public-edition hint, Beta by default
 *
 * @returns Zensical Studio or nothing
 */
export async function getStudio(
  context: Context,
  access: StudioAccess = { edition: "beta" },
): Promise<Studio | undefined> {
  const local = await getLocalStudio(context);
  if (local !== undefined) {
    return local;
  }
  let release: Release | undefined;
  let failure: NetworkError | undefined;
  try {
    release = await fetchRelease(context, access.edition);
  } catch (error) {
    if (!(error instanceof NetworkError)) {
      throw error;
    }
    failure = error;
  }

  // Offline access is limited to the same license, signed lease and exact
  // installed release. Explicit license rejection must never revive it.
  if (
    release === undefined && failure !== undefined && !failure.license.rejected
  ) {
    const cached = await readAccess(context);
    if (cached !== undefined) {
      const executable = await getStudioPath(
        context, cached.edition, undefined, cached,
      );
      if (executable !== undefined) {
        return {
          ...executable,
          edition: cached.edition,
          token: cached.access.token,
        };
      }
    }
  }

  const edition = release?.edition ?? (release ? "beta" : access.edition);
  if (access.edition === "free" && edition === "beta") {
    throw new AccessRejectedError(410);
  }
  const executable = await getStudioPath(context, edition, release);
  if (executable === undefined) {
    if (failure !== undefined) {
      throw failure;
    }
    return;
  }
  if (edition === "free") {
    return {
      ...executable,
      edition,
      license: {
        error: release?.license?.error || failure?.license.error || false,
      },
    };
  }
  if (edition === "pro" || edition === "team") {
    if (release?.access?.token === undefined) {
      return;
    }
    await rememberAccess(context, release);
    return { ...executable, edition, token: release.access.token };
  }

  // Keep the existing Beta lease endpoint compatible with older servers.
  const token = await getToken(context);
  if (token === undefined) {
    context.log("Token not found or expired.");
    return;
  }
  return { ...executable, edition: "beta", token };
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Resolve a configured Free executable without contacting delivery.
 *
 * @param context - Context
 *
 * @returns Local Free runtime, or nothing for the normal access flow
 */
async function getLocalStudio(context: Context): Promise<Studio | undefined> {
  const path = context.getConfiguration().get<string>("path") ?? "";
  if (path.trim() === "") {
    return;
  }
  try {
    const { stdout } = await promisify(execFile)(path, ["info", "--json"], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    const info: unknown = JSON.parse(stdout);
    if (
      typeof info === "object" && info !== null &&
      "edition" in info && info.edition === "free" &&
      "version" in info && typeof info.version === "string"
    ) {
      context.log(`Using Zensical Studio from: ${path}`);
      return { path, edition: "free", version: info.version, local: true };
    }
  } catch {
    // Older or unavailable executables retain the existing access flow.
  }
  return;
}

/**
 * Resolve a configured or managed Zensical Studio executable.
 *
 * @param context - Context
 * @param edition - Server-selected runtime edition
 * @param release - Resolved release, or nothing for offline reuse
 * @param identity - Required cached installation identity, if any
 *
 * @returns Executable path and recorded version, or nothing if unavailable
 */
async function getStudioPath(
  context: Context,
  edition: StudioEdition,
  release: Release | undefined,
  identity?: StudioInstallation,
): Promise<{
  path: string;
  version?: string;
} | undefined> {
  const config = context.getConfiguration();

  // Check for a path override in the configuration. If the path is not set,
  // download and install Zensical Studio - this is the default.
  const path = config.get<string>("path") ?? "";
  if (path.trim() === "") {
    return getInstalledStudio(context, edition, release, identity);
  }

  // Otherwise, use the configured path and check if it exists
  context.log(`Using Zensical Studio from: ${path}`);
  if (fs.existsSync(path)) {
    return { path };
  } else {
    context.log("Zensical Studio not found.");
    return;
  }
}
