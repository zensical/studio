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

import path from "node:path";
import { fileURLToPath } from "node:url";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Paths to relevant files and directories.
 */
export interface Paths {
  base: string;
  languages: string;
  manifest: string;
  grammar: {
    source: string;
    target: string;
  };
  test: {
    specs: string;
    snapshots: string;
  };
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get paths to relevant files and directories.
 *
 * @param importUrl - Import URL of the current module
 *
 * @returns Paths to relevant files and directories
 */
export function getPaths(importUrl: string): Paths {
  const scripts = path.dirname(fileURLToPath(importUrl));
  const base = path.resolve(scripts, "..");
  const source = path.resolve(base, "src");
  const target = path.resolve(
    base,
    "..",
    "..",
    "..",
    "integrations",
    "code",
    "syntaxes",
  );

  // Assemble and return paths
  return {
    base: source,
    languages: path.join(source, "languages.json"),
    manifest: path.resolve(
      base,
      "..",
      "..",
      "..",
      "integrations",
      "code",
      "package.json",
    ),
    grammar: {
      source: path.join(source, "python-markdown.tmLanguage.yml"),
      target: path.join(target, "python-markdown.tmLanguage.json"),
    },
    test: {
      specs: path.join(base, "test", "specs"),
      snapshots: path.join(base, "test", "snapshots"),
    },
  };
}
