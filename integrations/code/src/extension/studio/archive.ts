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

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as tar from "tar";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Extract the archive to the given directory.
 *
 * @param file - Path to archive file
 * @param target - Target directory
 */
export async function extract(file: string, target: string): Promise<void> {
  if (file.endsWith(".tar.gz")) {
    await extractTarGz(file, target);
  } else if (file.endsWith(".zip")) {
    await extractZip(file, target);
  } else {
    throw new Error(`Unsupported archive format: ${file}`);
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Extract the `*.tar.gz` archive to the given directory.
 *
 * @param file - Path to archive file
 * @param target - Target directory
 */
async function extractTarGz(file: string, target: string): Promise<void> {
  return tar.extract({ file, cwd: target, keepExisting: false });
}

/**
 * Extract the `*.zip` archive to the given directory.
 *
 * @param file - Path to archive file
 * @param target - Target directory
 */
async function extractZip(file: string, target: string): Promise<void> {
  const buffer = new Uint8Array(await fs.readFile(file));
  const reader = new ZipReader(new Uint8ArrayReader(buffer));
  try {
    for (const entry of await reader.getEntries()) {
      const file = resolve(entry.filename, target);
      if (entry.directory) {
        await fs.mkdir(file, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, await entry.getData(new Uint8ArrayWriter()));
      }
    }
  } finally {
    await reader.close();
  }
}

/* ------------------------------------------------------------------------- */

/**
 * Resolve the archive entry path to the target directory.
 *
 * @param file - Path to archive entry file
 * @param target - Target directory
 *
 * @returns Resolved path of the archive entry
 */
function resolve(file: string, target: string): string {
  const absolute = path.resolve(target, file);
  const relative = path.relative(target, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsupported archive entry path: ${file}`);
  } else {
    return absolute;
  }
}
