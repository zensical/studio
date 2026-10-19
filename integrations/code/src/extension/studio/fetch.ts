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
import type { StudioEdition } from "./binary";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Zensical Studio release.
 */
export interface Release {
  version: string;
  edition?: StudioEdition;
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
  /**
   * Unique message identifier.
   */
  id: string;
  /**
   * Message kind.
   */
  kind: "info" | "warning" | "error";
  /**
   * Message text, displayed in a dialog.
   */
  message: string;
  /**
   * Whether the message requires user confirmation before proceeding.
   */
  confirm?: boolean;
  /**
   * Optional document
   */
  markdown?: string;
}

/**
 * Validated presentation for the once-only Beta-to-Free handoff.
 */
export interface TransitionMessage extends Message {
  kind: "info";
  markdown: string;
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
 * Explicit access rejection, distinct from temporary service unavailability.
 */
export class AccessRejectedError extends Error {
  /** Rejection status; 410 identifies the end of beta access. */
  public readonly status: 401 | 403 | 410;

  public constructor(status: 401 | 403 | 410) {
    super(status === 410 ? "Beta access has ended" : "Studio access was rejected");
    this.name = "AccessRejectedError";
    this.status = status;
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
  edition: StudioEdition = "beta",
): Promise<Release | undefined> {
  context.log("Checking for updates");

  // Resolve the latest release for the underlying platform and architecture
  const url = "https://get.zensical.org/studio/";
  const res = await fetchResponse(context, url, {
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
      edition,
    }),
  });
  // Server retirement also applies to fresh clients with a slow local clock.
  if (edition === "beta" && res.status === 410) {
    throw new AccessRejectedError(410);
  }
  if (!res.ok) {
    context.log(`Fetching failed: ${res.status} ${res.statusText}`);
    return;
  }
  return (await res.json()) as Release;
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
    const res = await fetchResponse(context, url, {
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
    });

    if (res.status === 401 || res.status === 403 || res.status === 410) {
      throw new AccessRejectedError(res.status);
    }
    if (!res.ok) {
      context.log(`Fetching failed: ${res.status} ${res.statusText}`);
      if (res.status === 408 || res.status === 429 ||
          (res.status >= 500 && res.status < 600)) {
        throw new NetworkError("Token service temporarily unavailable");
      }
      return;
    }

    // Do not replace the cache or revive prior access on a malformed response.
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new NetworkError("Token transfer interrupted");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Invalid token response");
    }
    if (typeof body !== "object" || body === null ||
        !("token" in body) || typeof body.token !== "string" || !body.token.trim()) {
      throw new Error("Invalid token response");
    }
    return { token: body.token };
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

/* ------------------------------------------------------------------------- */

/**
 * Reuse the last valid response when the first Free startup is offline.
 *
 * @param context - Context
 *
 * @returns Transition message or nothing
 */
export function getTransitionMessage(
  context: Context
): TransitionMessage | undefined {
  return transitionMessage(context.getState<unknown>("betaTransitionMessage"));
}

/**
 * Optional presentation storage must never prevent installation or startup.
 *
 * @param context - Context
 * @param release - Release
 */
export async function rememberTransitionMessage(
  context: Context, release: Release
): Promise<void> {
  if (release.edition !== "free") return;
  const message = transitionMessage(release.message);
  if (message === undefined) return;
  try {
    await context.setState("betaTransitionMessage", message);
  } catch (error) {
    try {
      context.log(
        `Could not retain Studio transition note: ${String(error)}`
      );
    } catch {
      /* The window may already be closing. */
    }
  }
}

/**
 * Validate a transition message.
 *
 * @param value - Value to validate
 *
 * @returns Transition message or nothing
 */
function transitionMessage(value: unknown): TransitionMessage | undefined {
  if (typeof value !== "object" || value === null) return;
  const message = value as Partial<Message>;
  if (message.kind === "info" &&
      typeof message.id === "string" && message.id.trim() && message.id.length <= 128 &&
      typeof message.message === "string" && message.message.trim() && message.message.length <= 2048 &&
      typeof message.markdown === "string" && message.markdown.trim() && message.markdown.length <= 131072) {
    return message as TransitionMessage;
  }
  return;
}
