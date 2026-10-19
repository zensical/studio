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

import type { Context } from "./context";
import { getInstalledStudio } from "./studio/installer";
import { getToken } from "./studio/token";
import type { StudioEdition } from "./studio/binary";

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
  /** Expected managed release version; absent for user-owned paths */
  version?: string;
  /** Startup lease for beta or paid runtimes */
  token?: string;
}

/**
 * Access selected by the runtime controller.
 *
 * Paid leases are issued separately.
 */
export type StudioAccess =
  | { edition: "beta" | "free" }
  | { edition: "pro" | "team"; token: string };

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get Zensical Studio configuration.
 *
 * @param context - Context
 * @param access - Selected runtime access, Beta by default
 *
 * @returns Zensical Studio or nothing
 */
export async function getStudio(
  context: Context,
  access: StudioAccess = { edition: "beta" },
): Promise<Studio | undefined> {
  if (
    (access.edition === "pro" || access.edition === "team") &&
    !access.token?.trim()
  ) {
    context.log("A paid runtime requires a startup lease.");
    return;
  }
  const executable = await getStudioPath(context, access.edition);
  if (typeof executable === "undefined") {
    return;
  }

  if (access.edition === "free") {
    return { ...executable, edition: "free" };
  }
  if (access.edition === "pro" || access.edition === "team") {
    return { ...executable, edition: access.edition, token: access.token };
  }

  // Fetch a token to start Zensical Studio - the beta is public, but limited
  // to a specific time window, which requires a periodic refresh of the token.
  // The token is valid for 7 days and cached in the extension's global state,
  // as this allows to work offline for up to 7 days.
  const token = await getToken(context);
  if (typeof token === "undefined") {
    context.log("Token not found or expired.");
    return;
  }

  // Return Zensical Studio configuration
  return { ...executable, edition: "beta", token };
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Resolve a configured or managed Zensical Studio executable.
 *
 * @param context - Context
 * @param edition - Selected runtime edition
 *
 * @returns Executable path and recorded version, or nothing if unavailable
 */
async function getStudioPath(
  context: Context,
  edition: StudioEdition,
): Promise<{ path: string; version?: string } | undefined> {
  const config = context.getConfiguration();

  // Check for a path override in the configuration. If the path is not set,
  // download and install Zensical Studio - this is the default.
  const path = config.get<string>("path") ?? "";
  if (path.trim() === "") {
    return getInstalledStudio(context, edition);
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
