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

import * as fs from "node:fs";

import type { Context } from "./context";
import { getStudioPathFromInstallation } from "./studio/installer";
import { getToken } from "./studio/token";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Zensical Studio configuration.
 */
export interface Studio {
  /** Path to Zensical Studio */
  path: string;
  /** Token */
  token: string;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get Zensical Studio configuration.
 *
 * @param context - Context
 *
 * @returns Zensical Studio or nothing
 */
export async function getStudio(context: Context): Promise<Studio | undefined> {
  const path = await getStudioPath(context);
  if (typeof path === "undefined") {
    return;
  }

  // Fetch a token to start Zensical Studio - the beta is public, but limited
  // to a specific time window, which requires a periodic refresh of the token.
  // The token is valid for 7 days and cached in the extension's global state,
  // as this allows to work offline for up to 7 days.
  const token = await getToken(context);
  if (typeof token === "undefined") {
    context.log("Token not found or expired.");
    context.showError(
      "Zensical Studio could not refresh the token. " +
        "Connect to the internet and reload the window.",
    );
    return;
  }

  // Return Zensical Studio configuration
  return { path, token };
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Get path to Zensical Studio.
 *
 * @param context - Context
 *
 * @returns Path to Zensical Studio or nothing
 */
async function getStudioPath(context: Context): Promise<string | undefined> {
  const config = context.getConfiguration();

  // Check for a path override in the configuration. If the path is not set,
  // download and install Zensical Studio - this is the default.
  const path = config.get<string>("path") ?? "";
  if (path.trim() === "") {
    return getStudioPathFromInstallation(context);
  }

  // Otherwise, use the configured path and check if it exists
  context.log(`Using Zensical Studio from: ${path}`);
  if (fs.existsSync(path)) {
    return path;
  } else {
    context.log("Zensical Studio not found.");
    return;
  }
}
