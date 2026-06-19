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

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";

import {
  getEmbeddedLanguages,
  setEmbeddedLanguagesInManifest,
} from "./grammar/languages.js";
import { getPaths } from "./grammar/paths.js";
import { render } from "./grammar/template.js";
import { inspect, test } from "./grammar/tests.js";

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

// Get paths to relevant files and directories
const paths = getPaths(import.meta.url);
const languages = await getEmbeddedLanguages(paths.languages);

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Build grammar and update manifest.
 */
async function build(): Promise<void> {
  await fsp.mkdir(path.dirname(paths.grammar.target), { recursive: true });
  const template = await fsp.readFile(paths.grammar.source, "utf8");

  // Render template with embedded languages and write to file
  const output = render(template, languages);
  await fsp.writeFile(
    paths.grammar.target,
    `${JSON.stringify(yaml.load(output), null, 2)}\n`,
  );

  // Update manifest with embedded languages
  await setEmbeddedLanguagesInManifest(paths.manifest, languages);
  console.log(`Built ${path.basename(paths.grammar.target)}`);
}

/**
 * Watch grammar source files and rebuild on changes.
 */
async function watch(): Promise<void> {
  let running = false;
  let queued = false;

  // Run build and queue subsequent builds if already running
  const run = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }

    // Mark build as running and execute it
    running = true;
    try {
      await build();
    } finally {
      running = false;

      // If a build was queued while running, execute it now
      if (queued) {
        queued = false;
        await run();
      }
    }
  };

  // Initial build
  await run();

  // Watch for changes in the base directory and rebuild
  fs.watch(paths.base, async (_, filename) => {
    if (!filename?.endsWith(".json") && !filename?.endsWith(".yml")) {
      return;
    }

    // Subsequent build
    await run();
  });

  // Keep the process alive until killed.
  await new Promise<void>(() => {});
}

/* ----------------------------------------------------------------------------
 * Program
 * ------------------------------------------------------------------------- */

switch (process.argv[2]) {
  case "watch":
    await watch();
    break;
  case "test":
    await build();
    await test(paths, languages, process.argv.includes("--update"));
    break;
  case "inspect":
    if (typeof process.argv[3] === "undefined") {
      throw new Error("Missing file argument");
    }
    await build();
    await inspect(paths, languages, process.argv[3]);
    break;
  default:
    await build();
    break;
}
