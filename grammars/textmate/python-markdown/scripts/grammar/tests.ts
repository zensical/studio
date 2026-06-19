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

import type { EmbeddedLanguage } from "./languages.js";
import type { Paths } from "./paths.js";
import type { LineSnapshot } from "./tokenizer.js";
import { tokenize } from "./tokenizer.js";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Test case.
 */
interface TestCase {
  group: string;
  name: string;
  source: string;
}

/**
 * Snapshot mismatch.
 */
interface Mismatch {
  line: number;
  token?: number;
  expected: unknown;
  actual: unknown;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Inspect token scopes for a Markdown file.
 *
 * @param paths - Paths
 * @param languages - Embedded languages
 * @param file - File to inspect
 */
export async function inspect(
  paths: Paths,
  languages: EmbeddedLanguage[],
  file: string,
): Promise<void> {
  const source = await fsp.readFile(path.resolve(process.cwd(), file), "utf8");
  const snapshots = await tokenize(paths.grammar.target, languages, source);
  process.stdout.write(`${JSON.stringify(snapshots, null, 2)}\n`);
}

/**
 * Run snapshot tests.
 *
 * @param paths - Paths
 * @param languages - Embedded languages
 * @param update - Whether to update snapshots
 */
export async function test(
  paths: Paths,
  languages: EmbeddedLanguage[],
  update: boolean,
): Promise<void> {
  const specs = await listSpecs(paths.test.specs);
  await fsp.mkdir(paths.test.snapshots, { recursive: true });
  if (specs.length === 0) {
    console.log("No specs found in test/specs");
    return;
  }

  // Tokenize each spec and compare it with its snapshot
  const failures: string[] = [];
  let passed = 0;
  for (const spec of specs) {
    const source = await fsp.readFile(spec, "utf8");
    const actual: Record<string, Record<string, LineSnapshot[]>> = {};
    const specs = parseSpec(source, spec);
    const relative = path.relative(paths.test.specs, spec);
    for (const spec of specs) {
      actual[spec.group] ??= {};
      actual[spec.group][spec.name] = await tokenize(
        paths.grammar.target,
        languages,
        spec.source,
      );
    }

    // Write snapshot if it doesn't exist or if update is requested
    const snapshot = snapshotPath(paths, spec);
    const actualText = `${JSON.stringify(actual, null, 2)}\n`;
    if (update || !fs.existsSync(snapshot)) {
      await fsp.mkdir(path.dirname(snapshot), { recursive: true });
      await fsp.writeFile(snapshot, actualText);
      console.log(
        `${update ? "Updated" : "Created"} ${path.relative(path.dirname(paths.base), snapshot)}`,
      );
      continue;
    }

    // Compare actual snapshot with expected snapshot
    const expected = JSON.parse(
      await fsp.readFile(snapshot, "utf8"),
    ) as Record<string, Record<string, LineSnapshot[]>>;
    for (const testCase of specs) {
      const label = `${relative} :: ${testCase.group} :: ${testCase.name}`;
      const mismatch = compare(
        expected[testCase.group]?.[testCase.name],
        actual[testCase.group]?.[testCase.name],
      );
      if (typeof mismatch === "undefined") {
        console.log(`PASS ${label}`);
        passed += 1;
      } else {
        console.error(`FAIL ${label}`);
        report(mismatch);
        failures.push(label);
      }
    }
  }

  // Report test results
  if (failures.length > 0) {
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exitCode = 1;
    return;
  }

  // Report snapshot updates
  if (update) {
    console.log(`\nUpdated ${specs.length} snapshot file(s)`);
    return;
  }

  // Print summary
  console.log(`\n${passed} passed, 0 failed`);
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * List spec files.
 *
 * @param directory - Spec directory
 *
 * @returns Spec files
 */
async function listSpecs(directory: string): Promise<string[]> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  // Recursively list spec files in the directory
  const specs: string[] = [];
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      specs.push(...(await listSpecs(file)));
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      specs.push(file);
    }
  }

  // Sort spec files for consistent order
  return specs.sort();
}

/**
 * Parse spec file.
 *
 * @param source - Spec file source
 * @param file - Spec file
 *
 * @returns Test cases
 */
function parseSpec(source: string, file: string): TestCase[] {
  const lines = source.split(/\r\n|\n|\r/);
  const cases: TestCase[] = [];
  const seen = new Set<string>();

  // Parse test cases from spec file
  let group = "";
  for (let index = 0; index < lines.length; index += 1) {
    const subheading = lines[index]?.match(/^##\s+(.+?)\s*$/);
    if (typeof subheading !== "undefined" && subheading !== null) {
      group = subheading[1].trim();
      continue;
    }

    // Test cases are Markdown headings followed by fenced blocks
    const heading = lines[index]?.match(/^###\s+(.+?)\s*$/);
    if (typeof heading === "undefined" || heading === null) {
      continue;
    }

    // Ensure that a group heading has been defined before the test case
    if (group === "") {
      throw new Error(`Expected group heading before test case in ${file}`);
    }

    // Ensure that the test case heading is unique within the group
    const name = heading[1].trim();
    const id = `${group}::${name}`;
    if (seen.has(id)) {
      throw new Error(`Duplicate test case heading '${id}' in ${file}`);
    }
    seen.add(id);

    // Skip empty lines after the heading
    index += 1;
    while (index < lines.length && lines[index].trim() === "") {
      index += 1;
    }

    // Test cases are Markdown fenced blocks after headings
    const fence = lines[index]?.match(/^(`{3,})\s*md\s*$/);
    if (typeof fence === "undefined" || fence === null) {
      throw new Error(`Expected fenced md block after heading '${name}' in ${file}`);
    }

    // Read the body of the fenced block until the closing fence is found
    index += 1;
    const body: string[] = [];
    while (index < lines.length && lines[index].trim() !== fence[1]) {
      body.push(lines[index]);
      index += 1;
    }

    // Ensure that the fenced block is closed
    if (index >= lines.length) {
      throw new Error(`Unclosed fenced md block for heading '${name}' in ${file}`);
    }

    // Add the test case to the list of cases
    cases.push({
      group,
      name,
      source: normalize(body.join("\n")),
    });
  }

  return cases;
}

/**
 * Normalize source text.
 *
 * @param source - Source text
 *
 * @returns Normalized source text
 */
function normalize(source: string): string {
  return source.endsWith("\n") ? source : `${source}\n`;
}

/**
 * Get snapshot path for a spec.
 *
 * @param paths - Paths
 * @param spec - Spec file
 *
 * @returns Snapshot path
 */
function snapshotPath(paths: Paths, spec: string): string {
  const relative = path.relative(paths.test.specs, spec);
  return path.join(
    paths.test.snapshots,
    relative.replace(/\.md$/, ".scopes.json"),
  );
}

/**
 * Compare expected and actual snapshots.
 *
 * @param expected - Expected snapshot
 * @param actual - Actual snapshot
 *
 * @returns First mismatch or nothing
 */
function compare(
  expected: LineSnapshot[] | undefined,
  actual: LineSnapshot[] | undefined,
): Mismatch | undefined {
  if (typeof expected === "undefined" || typeof actual === "undefined") {
    return {
      line: 0,
      expected,
      actual,
    };
  }

  // Compare line by line
  const length = Math.max(expected.length, actual.length);
  for (let line = 0; line < length; line += 1) {
    const expectedLine = expected[line];
    const actualLine = actual[line];
    if (typeof expectedLine === "undefined" || typeof actualLine === "undefined") {
      return {
        line,
        expected: expectedLine,
        actual: actualLine,
      };
    }

    // Compare line text and token counts
    if (expectedLine.line !== actualLine.line) {
      return {
        line,
        expected: expectedLine,
        actual: actualLine,
      };
    }

    // Compare tokens within the line
    const tokens = Math.max(expectedLine.tokens.length, actualLine.tokens.length);
    for (let token = 0; token < tokens; token += 1) {
      const expectedToken = expectedLine.tokens[token];
      const actualToken = actualLine.tokens[token];
      if (typeof expectedToken === "undefined" || typeof actualToken === "undefined") {
        return {
          line,
          token,
          expected: expectedToken,
          actual: actualToken,
        };
      }

      // Compare token text and scopes
      if (
        expectedToken.text !== actualToken.text ||
        expectedToken.scopes.length !== actualToken.scopes.length ||
        expectedToken.scopes.some((scope, index) => scope !== actualToken.scopes[index])
      ) {
        return {
          line,
          token,
          expected: expectedToken,
          actual: actualToken,
        };
      }
    }
  }

  return;
}

/**
 * Report mismatch.
 *
 * @param mismatch - Mismatch
 */
function report(mismatch: Mismatch): void {
  const location =
    typeof mismatch.token === "undefined"
      ? `line ${mismatch.line + 1}`
      : `line ${mismatch.line + 1}, token ${mismatch.token + 1}`;

  // Report mismatch details
  console.error(`  first mismatch at ${location}`);
  console.error(`  expected: ${JSON.stringify(mismatch.expected)}`);
  console.error(`  actual:   ${JSON.stringify(mismatch.actual)}`);
}
