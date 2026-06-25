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
import { createRequire } from "node:module";

import oniguruma from "vscode-oniguruma";
import textmate from "vscode-textmate";

import type { EmbeddedLanguage } from "./languages.js";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Token snapshot.
 */
export interface TokenSnapshot {
  text: string;
  scopes: string[];
}

/**
 * Line snapshot.
 */
export interface LineSnapshot {
  line: string;
  tokens: TokenSnapshot[];
}

/**
 * Raw TextMate grammar.
 */
interface RawGrammar {
  name: string;
  scopeName: string;
  patterns: unknown[];
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Tokenize source with the Python Markdown grammar.
 *
 * @param grammar - Path to grammar file
 * @param languages - Embedded languages
 * @param source - Source text
 *
 * @returns Line snapshots
 */
export async function tokenize(
  grammar: string,
  languages: EmbeddedLanguage[],
  source: string,
): Promise<LineSnapshot[]> {
  const registry = await loadRegistry(grammar, languages);
  const language = await registry.loadGrammar("text.html.markdown.python");
  if (language === null) {
    throw new Error("Failed to load text.html.markdown.python");
  }

  // Tokenize source line by line, carrying the TextMate rule stack forward
  const lines = source.split(/\r\n|\n|\r/);
  const snapshots: LineSnapshot[] = [];
  let stack: textmate.StateStack = textmate.INITIAL;
  for (const line of lines) {
    const result = language.tokenizeLine(line, stack);
    stack = result.ruleStack;

    // Convert tokens to snapshots, filtering out empty tokens
    const tokens = result.tokens
      .map((token) => ({
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      }))
      .filter((token) => token.text.length > 0);

    // Add line snapshot to the list
    snapshots.push({ line, tokens });
  }

  // Return the list of line snapshots
  return snapshots;
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Load TextMate grammar registry.
 *
 * @param grammar - Path to grammar file
 * @param languages - Embedded languages
 *
 * @returns TextMate registry
 */
async function loadRegistry(
  grammar: string,
  languages: EmbeddedLanguage[],
): Promise<textmate.Registry> {
  const require = createRequire(import.meta.url);
  const wasm = await fs.readFile(
    require.resolve("vscode-oniguruma/release/onig.wasm"),
  );

  // Load the Oniguruma WebAssembly module
  await oniguruma.loadWASM(wasm);
  return new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner(patterns: string[]) {
        return new oniguruma.OnigScanner(patterns);
      },
      createOnigString(value: string) {
        return new oniguruma.OnigString(value);
      },
    }),
    loadGrammar: async (scope: string) => {
      if (scope === "text.html.markdown.python") {
        return textmate.parseRawGrammar(
          await fs.readFile(grammar, "utf8"),
          grammar,
        );
      }

      // Load embedded grammar for the given scope
      const embedded = getEmbeddedGrammar(scope, languages);
      if (typeof embedded !== "undefined") {
        return textmate.parseRawGrammar(
          `${JSON.stringify(embedded, null, 2)}\n`,
          `${scope}.tmLanguage.json`,
        );
      }

      // Return nothing if no grammar is found for the given scope
      return null;
    },
  });
}

/**
 * Get fake embedded grammar for a scope.
 *
 * @param scope - Scope name
 * @param languages - Embedded languages
 *
 * @returns Raw grammar or nothing
 */
function getEmbeddedGrammar(
  scope: string,
  languages: EmbeddedLanguage[],
): RawGrammar | undefined {
  if (scope === "source.yaml") {
    return getYamlGrammar();
  }
  if (scope === "text.html.markdown.math") {
    return { name: "Test Markdown Math", scopeName: scope, patterns: [] };
  }

  // Return a minimal grammar for every embedded language scope
  const language = languages.find((language) => language.scope === scope);
  if (typeof language !== "undefined") {
    return {
      name: `Test ${language.language}`,
      scopeName: language.scope,
      patterns: [],
    };
  }

  // Return nothing if no grammar is found
  return;
}

/**
 * Get fake YAML grammar.
 *
 * @returns Raw grammar
 */
function getYamlGrammar(): RawGrammar {
  return {
    name: "Test YAML",
    scopeName: "source.yaml",
    patterns: [
      {
        match: "^.*$",
        name: "meta.line.yaml",
      },
    ],
  };
}
