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

/** URI components needed for directory containment. */
export interface UriPath {
  scheme: string;
  authority: string;
  path: string;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Check whether a URI is equal to or below a root URI.
 *
 * @param uri - URI to check
 * @param root - Root URI to check against
 * @param caseInsensitive - Whether to perform case-insensitive comparison
 *
 * @returns Whether the URI is equal to or below the root URI
 */
export function isUriInside(
  uri: UriPath,
  root: UriPath,
  caseInsensitive = process.platform === "win32" &&
    uri.scheme === "file" && root.scheme === "file",
): boolean {
  if (uri.scheme !== root.scheme) {
    return false;
  }

  // Normalize authority and path for case-insensitive comparison on Windows
  const normalize = caseInsensitive
    ? (value: string) => value.toLowerCase()
    : (value: string) => value;
  if (normalize(uri.authority) !== normalize(root.authority)) {
    return false;
  }

  // Normalize path and check if it is equal to or starts with the root path
  const path = normalize(uri.path);
  const rootPath = normalize(root.path);
  const prefix = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return path === rootPath || path.startsWith(prefix);
}
