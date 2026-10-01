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
 * Class
 * ------------------------------------------------------------------------- */

/**
 * Retryable network failure.
 */
export class NetworkError extends Error {
  /**
   * Create error.
   *
   * @param message - Message
   */
  public constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * Archive transfer failure.
 */
export class ArchiveTransferError extends Error {
  /** Transfer diagnostics safe to include in an issue report. */
  public readonly diagnostics: string;

  /**
   * Create error.
   *
   * @param message - Message
   * @param diagnostics - Transfer diagnostics
   * @param cause - Underlying error
   */
  public constructor(
    message: string, diagnostics: string, cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ArchiveTransferError";
    this.diagnostics = diagnostics;
  }
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
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchResponse(context, release.url);
  } catch (error) {
    throw archiveTransferError(release, started, 0, undefined, error);
  }
  if (!res.ok) {
    throw archiveTransferError(release, started, 0, res);
  }
  if (!isArchiveContentType(res.headers.get("content-type"))) {
    throw archiveTransferError(
      release, started, 0, res,
      new Error("Unexpected archive content type"),
    );
  }

  // Read the response as a stream so interrupted transfers retain their
  // received byte count in diagnostics.
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    if (res.body === null) {
      throw new Error("Archive response has no body");
    }
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
  } catch (error) {
    throw archiveTransferError(release, started, received, res, error);
  }

  // Check that the received byte count matches the expected content length
  const expected = contentLength(res);
  if (typeof expected !== "undefined" && received !== expected) {
    throw archiveTransferError(
      release, started, received, res,
      new Error(`Received ${received} of ${expected} bytes`),
    );
  }

  // Combine the received chunks into a single byte array and return it
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
  const url = "https://get.zensical.org/studio/token/";
  try {
    const res = await request(context, url, {
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
    });

    // Return the new token if available
    if (typeof res !== "undefined") {
      return (await res.json()) as Token;
    } else {
      return;
    }
  } catch (error) {
    if (typeof token !== "undefined" && error instanceof NetworkError) {
      context.log("Using cached token");
      return { token };
    }
    throw error;
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
  const res = await fetchResponse(context, url, init);

  // In case of a non-OK response, log the error and return nothing
  if (!res.ok) {
    context.log(`Fetching failed: ${res.status} ${res.statusText}`);
    return;
  } else {
    return res;
  }
}

/**
 * Fetch a resource and preserve non-OK responses for callers that need them.
 *
 * @param context - Context
 * @param url - Resource URL
 * @param init - Request initialization
 *
 * @returns Response
 */
async function fetchResponse(
  context: Context,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        "x-zensical-studio-version": context.getVersion(),
      },
    });
  } catch (error) {
    const reason = describeError(error);
    context.log(`Fetching failed: ${reason}`);
    throw new NetworkError(reason);
  }
}

/**
 * Create an archive transfer error with safe diagnostics.
 *
 * @param release - Release
 * @param started - Transfer start time
 * @param received - Number of received bytes
 * @param response - Response, if headers were received
 * @param cause - Underlying error
 *
 * @returns Archive transfer error
 */
function archiveTransferError(
  release: Release, started: number, received: number,
  response?: Response, cause?: unknown,
): ArchiveTransferError {
  const expected = response === undefined ? undefined : contentLength(response);
  const reason = cause === undefined
    ? `HTTP ${response?.status ?? "unknown"} ${response?.statusText ?? ""}`.trim()
    : describeError(cause);
  const diagnostics = [
    `Release: ${release.version}`,
    `Status: ${response?.status ?? "unavailable"}`,
    `Final URL: ${safeUrl(response?.url || release.url)}`,
    `Redirected: ${response?.redirected ?? false}`,
    `Content-Type: ${response?.headers.get("content-type") ?? "unavailable"}`,
    `Content-Length: ${expected ?? "unavailable"}`,
    `Content-Encoding: ${response?.headers.get("content-encoding") ?? "none"}`,
    `ETag: ${response?.headers.get("etag") ?? "unavailable"}`,
    `CF-Ray: ${response?.headers.get("cf-ray") ?? "unavailable"}`,
    `Received bytes: ${received}`,
    `Elapsed milliseconds: ${Date.now() - started}`,
    `Error: ${reason}`,
  ].join("\n");
  return new ArchiveTransferError(
    `Archive transfer failed: ${reason}`, diagnostics, cause,
  );
}

/**
 * Remove credentials, query parameters, and fragments from a diagnostic URL.
 *
 * @param value - URL
 *
 * @returns Safe URL
 */
function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "unavailable";
  }
}

/**
 * Check whether a response contains the expected archive media type.
 *
 * @param value - Content type
 *
 * @returns Whether the content type is valid
 */
function isArchiveContentType(value: string | null): boolean {
  const type = value?.split(";", 1)[0].trim().toLowerCase();
  return type === "application/octet-stream";
}

/**
 * Read a valid content length from a response.
 *
 * @param response - Response
 *
 * @returns Content length or nothing
 */
function contentLength(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : undefined;
}

/**
 * Describe an error and its immediate cause.
 *
 * @param error - Error
 *
 * @returns Description
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = [error.name, sanitizeText(error.message)];
  const code = errorCode(error);
  if (typeof code !== "undefined") details.push(`code=${code}`);
  if (error.cause instanceof Error) {
    const cause = error.cause;
    const causeCode = errorCode(cause);
    details.push(
      `cause=${cause.name}: ${sanitizeText(cause.message)}` +
      (typeof causeCode === "undefined" ? "" : ` (code=${causeCode})`),
    );
  }
  return details.join(": ");
}

/**
 * Remove credentials and query parameters from URLs in diagnostic text.
 *
 * @param value - Diagnostic text
 *
 * @returns Safe diagnostic text
 */
function sanitizeText(value: string): string {
  return value.replace(/https?:\/\/[^\s)]+/g, (url) => safeUrl(url));
}

/**
 * Get a string error code without assuming a specific error implementation.
 *
 * @param error - Error
 *
 * @returns Error code or nothing
 */
function errorCode(error: Error): string | undefined {
  if (!("code" in error)) return;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
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
