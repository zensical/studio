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

import { createHash } from "node:crypto";

import type { Context } from "../context";
import type { StudioInstallation } from "./binary";
import type { Release } from "./fetch";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Cached runtime access, bound to a license and verified installation.
 */
interface CachedAccess extends StudioInstallation {
  edition: "pro" | "team";
  access: {
    token: string;
  };
  license: {
    error: boolean;
    fingerprint: string;
  };
}

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/**
 * Versioned runtime cache. Older entries require online revalidation.
 */
const key = "zensical.studio.access.v2";

/**
 * Credential fingerprint rejected for the current cache version.
 */
const rejected = "access.rejected";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Bind cached access to the credential used for its resolution request.
 *
 * @param license - License credential
 *
 * @returns Credential fingerprint
 */
export function licenseFingerprint(license: string): string {
  return createHash("sha256").update(license).digest("hex");
}

/**
 * Read an unexpired cached lease for the current license.
 *
 * The native verifier still authorizes the signed runtime lease. Decoded expiry
 * only avoids attempting to start an already expired cached runtime.
 *
 * @param context - Extension context
 *
 * @returns Cached access, or nothing
 */
export async function readAccess(
  context: Context,
): Promise<CachedAccess | undefined> {
  try {
    const license = (await context.getLicenseKey())?.trim();
    if (
      !license ||
      context.getState(rejected) === licenseFingerprint(license)
    ) {
      return;
    }
    const stored = await context.getSecret(key);
    if (stored === undefined) {
      return;
    }
    const access = JSON.parse(stored) as Partial<CachedAccess>;
    if (
      access === null ||
      (access.edition !== "pro" && access.edition !== "team") ||
      access.license?.fingerprint !== licenseFingerprint(license) ||
      typeof access.version !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(access.version) ||
      typeof access.integrity !== "string" ||
      !/^sha256-[a-f0-9]{64}$/i.test(access.integrity) ||
      typeof access.access?.token !== "string"
    ) {
      return;
    }
    const payload = JSON.parse(
      Buffer.from(access.access.token.split(".")[1], "base64url").toString(),
    );
    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 + 60_000 <= Date.now()
    ) {
      return;
    }
    access.integrity = access.integrity.toLowerCase();
    return access as CachedAccess;
  } catch {
    context.log("Could not read cached Studio access.");
    return;
  }
}

/**
 * Retain only the runtime lease, never a download grant or customer license.
 *
 * @param context - Extension context
 * @param release - Successfully installed licensed release
 */
export async function rememberAccess(
  context: Context,
  release: Release,
): Promise<void> {
  if (
    (release.edition !== "pro" && release.edition !== "team") ||
    release.access?.token === undefined ||
    release.license?.fingerprint === undefined
  ) {
    return;
  }
  try {
    await context.setSecret(
      key,
      JSON.stringify({
        edition: release.edition,
        version: release.version,
        integrity: release.integrity.toLowerCase(),
        access: { token: release.access.token },
        license: {
          error: false,
          fingerprint: release.license.fingerprint,
        },
      }),
    );
    await context.setState(rejected, undefined);
  } catch {
    context.log("Could not retain the Studio runtime lease.");
  }
}

/**
 * Discard offline access after an explicit credential rejection.
 *
 * @param context - Extension context
 * @param fingerprint - Credential whose access was explicitly rejected
 */
export async function forgetAccess(
  context: Context,
  fingerprint?: string,
): Promise<void> {
  if (fingerprint !== undefined) {
    try {
      await context.setState(rejected, fingerprint);
    } catch {
      context.log("Could not retain the Studio access rejection.");
    }
  }
  try {
    await context.setSecret(key, undefined);
  } catch {
    context.log("Could not clear cached Studio access.");
  }
}
