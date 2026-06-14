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

import type { Context } from "../context";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Zensical Studio release.
 */
export interface Release {
  version: string;
  edition: "beta";
  url: string;
  integrity: string;
  extension?: {
    version: string;
  };
  message?: Message;
}

/**
 * Zensical Studio token.
 */
export interface Token {
  token: string;
}

/* ------------------------------------------------------------------------- */

/**
 * Message.
 */
export interface Message {
  id: string;
  kind: "info" | "warning" | "error";
  message: string;
  confirm: boolean;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Resolve the latest Zensical Studio release.
 *
 * @param context - Context
 *
 * @returns Release or nothing
 */
export async function fetchRelease(
  context: Context,
): Promise<Release | undefined> {
  context.log("Checking for updates");

  // Resolve the latest release for the underlying platform and architecture
  const url = "https://get.zensical.org/studio/";
  const res = await request(context, url, {
    cache: "no-store",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    body: JSON.stringify({
      platform: getPlatform(),
      architecture: getArchitecture(),
    }),
  });
  if (typeof res !== "undefined") {
    return (await res.json()) as Release;
  } else {
    return;
  }
}

/**
 * Fetch a Zensical Studio archive.
 *
 * @param context - Context
 * @param release - Release
 *
 * @returns Archive as bytes or nothing
 */
export async function fetchArchive(
  context: Context,
  release: Release,
): Promise<Uint8Array | undefined> {
  context.log(`Fetching Zensical Studio ${release.version}`);

  // Fetch the archive for the given release
  const res = await request(context, release.url);
  if (typeof res !== "undefined") {
    return new Uint8Array(await res.arrayBuffer());
  } else {
    return;
  }
}

/**
 * Fetch a Zensical Studio token.
 *
 * @param context - Context
 * @param token - Previous token
 */
export async function fetchToken(
  context: Context,
  token?: string,
): Promise<Token | undefined> {
  context.log("Renewing token for beta access");

  // Fetch a new token
  const url = "https://get.zensical.org/studio/token/";
  const res = await request(context, url, {
    ...(token && { headers: { authorization: `Bearer ${token}` } }),
  });
  if (typeof res !== "undefined") {
    return (await res.json()) as Token;
  } else {
    return;
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Fetch a resource.
 *
 * @param context - Context
 * @param url - Resource URL
 * @param init - Request initialization
 *
 * @returns Response or nothing
 */
async function request(
  context: Context,
  url: string,
  init?: RequestInit,
): Promise<Response | undefined> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        "x-zensical-studio-version": context.getVersion(),
      },
    });

    // In case of a non-OK response, log the error and return nothing
    if (!res.ok) {
      context.log(`Fetching failed: ${res.status} ${res.statusText}`);
      return;
    } else {
      return res;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    context.log(`Fetching failed: ${reason}`);
    return;
  }
}

/* ------------------------------------------------------------------------- */

/**
 * Get platform for Zensical Studio.
 *
 * @returns Platform
 */
function getPlatform(): string {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return process.platform;
  }
}

/**
 * Get architecture for Zensical Studio.
 *
 * @returns Architecture
 */
function getArchitecture(): string {
  return process.arch;
}
