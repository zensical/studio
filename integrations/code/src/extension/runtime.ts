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

import { valid } from "semver";
import type { InitializeResult } from "vscode-languageclient/node";

import type { Studio } from "./studio";
import type { StudioEdition } from "./studio/binary";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Compiled identity reported by the initialized language server.
 */
export interface RuntimeIdentity {
  /** Runtime version */
  version: string;
  /** Compiled edition */
  edition: StudioEdition;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Reconcile the running process with the selected installation.
 *
 * @param studio - Selected runtime
 * @param result - Language server initialization result
 *
 * @returns Compiled runtime identity
 *
 * @throws Error if the runtime identity is missing, invalid or inconsistent
 */
export function reconcileRuntime(
  studio: Studio,
  result: InitializeResult | undefined,
): RuntimeIdentity {
  if (result === undefined) {
    throw new Error("Studio did not report an initialization result");
  }
  const version = parseVersion(result.serverInfo?.version);
  const reported: unknown = result.capabilities.experimental?.zensicalStudio;
  let identity: RuntimeIdentity;
  if (reported === undefined) {
    // Beta may omit edition metadata regardless of its version. Other
    // editions must report their compiled identity.
    if (studio.edition !== "beta") {
      throw new Error("Studio did not report its compiled edition");
    }
    identity = { version, edition: "beta" };
  } else {
    if (
      typeof reported !== "object" || reported === null ||
      !("edition" in reported) || !("version" in reported) ||
      typeof reported.edition !== "string" ||
      !["beta", "free", "pro", "team"].includes(reported.edition)
    ) {
      throw new Error("Studio reported an invalid runtime identity");
    }
    identity = {
      version: parseVersion(reported.version),
      edition: reported.edition as StudioEdition,
    };
    if (identity.version !== version) {
      throw new Error(
        "Studio runtime version disagrees with its server version",
      );
    }
  }
  if (identity.edition !== studio.edition) {
    throw new Error(
      `Studio runtime edition mismatch: expected ${studio.edition}, ` +
        `received ${identity.edition}`,
    );
  }
  if (
    studio.version !== undefined &&
    parseVersion(studio.version) !== identity.version
  ) {
    throw new Error(
      `Studio runtime version mismatch: expected ${studio.version}, ` +
        `received ${identity.version}`,
    );
  }
  return identity;
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Normalize a complete SemVer version, including a release metadata v prefix.
 *
 * @param value - Version to normalize
 *
 * @returns Normalized version
 *
 * @throws Error if the value is not a complete SemVer version
 */
function parseVersion(value: unknown): string {
  const version = typeof value === "string" ? valid(value) : null;
  if (version === null) {
    throw new Error("Studio reported an invalid runtime version");
  }
  return version;
}
