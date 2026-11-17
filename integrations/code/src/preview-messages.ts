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

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Identity of the exact document render that supplied an action.
 */
export interface PreviewActionContext {
  session: string;
  uri: string;
  generation: string;
}

/**
 * Messages accepted from the bundled preview webview.
 */
export type PreviewMessage =
  | { type: "preview/ready" }
  | {
    type: "preview/reveal-source";
    context: PreviewActionContext;
    uri: string;
    end: number;
  }
  | {
    type: "preview/select-variant";
    context: PreviewActionContext;
    variant: string;
  }
  | {
    type: "preview/open-link";
    context: PreviewActionContext;
    href: string;
  };

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Decode the private bundled webview protocol before dispatching any action.
 *
 * @param value - Message received from the webview
 *
 * @returns Validated preview message, or undefined
 */
export function decodePreviewMessage(
  value: unknown,
): PreviewMessage | undefined {
  if (!record(value)) return undefined;
  if (value.type === "preview/ready") {
    return keys(value, ["type"]) ? { type: "preview/ready" } : undefined;
  }
  if (
    !record(value.context) ||
    !keys(value.context, ["session", "uri", "generation"]) ||
    !text(value.context.session, 128) ||
    !fileUri(value.context.uri) ||
    !text(value.context.generation, 128)
  ) {
    return undefined;
  }
  switch (value.type) {
    case "preview/reveal-source":
      if (
        !keys(value, ["type", "context", "uri", "end"]) ||
        !fileUri(value.uri) ||
        !Number.isSafeInteger(value.end) ||
        (value.end as number) < 0
      ) {
        return undefined;
      }
      break;
    case "preview/select-variant":
      if (
        !keys(value, ["type", "context", "variant"]) ||
        !text(value.variant, 4096)
      ) {
        return undefined;
      }
      break;
    case "preview/open-link":
      if (
        !keys(value, ["type", "context", "href"]) ||
        !text(value.href, 64 * 1024)
      ) {
        return undefined;
      }
      break;
    default:
      return undefined;
  }
  return value as unknown as PreviewMessage;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function text(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    Buffer.byteLength(value, "utf8") <= limit &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function fileUri(value: unknown): value is string {
  if (!text(value, 64 * 1024)) return false;
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
}
