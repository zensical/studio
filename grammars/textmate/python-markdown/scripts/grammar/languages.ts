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

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Embedded language.
 */
export interface EmbeddedLanguage {
  language: string;
  scope: string;
  aliases: string[];
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get embedded languages from file.
 *
 * @param file - Path to file
 *
 * @returns Embedded languages
 */
export async function getEmbeddedLanguages(
  file: string,
): Promise<EmbeddedLanguage[]> {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data) as EmbeddedLanguage[];
}

/**
 * Set embedded languages in manifest.
 *
 * @param file - Path to manifest file
 * @param languages - Embedded languages
 */
export async function setEmbeddedLanguagesInManifest(
  file: string,
  languages: EmbeddedLanguage[],
): Promise<void> {
  const data = await fs.readFile(file, "utf8");
  const manifest = JSON.parse(data) as {
    contributes?: {
      grammars?: Array<Record<string, unknown>>;
    };
  };

  // Find contribution for Python Markdown grammar
  const contribution = manifest.contributes?.grammars?.find(
    (grammar) => grammar.scopeName === "text.html.markdown.python",
  );

  // Set embedded languages in contribution
  if (typeof contribution !== "undefined") {
    contribution.embeddedLanguages = mapEmbeddedLanguages(languages);
    await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Create map of embedded languages.
 *
 * @param embedded - Embedded languages
 *
 * @returns Map of embedded languages
 */
function mapEmbeddedLanguages(
  embedded: EmbeddedLanguage[],
): Record<string, string> {
  const entries: Array<[string, string]> = [];

  // Add embedded languages
  for (const { language } of embedded) {
    entries.push([`meta.embedded.block.${language}`, language]);
  }

  // Add Python Markdown as embedded language
  entries.push(["meta.embedded.block.markdown", "python-markdown"]);
  entries.sort(([left], [right]) => left.localeCompare(right));

  // Add inline embedded languages
  for (const { language } of embedded) {
    entries.push([`meta.embedded.inline.${language}`, language]);
  }

  // Add Python Markdown as inline embedded language
  entries.push(["meta.embedded.inline.markdown", "python-markdown"]);
  entries.sort(([left], [right]) => left.localeCompare(right));

  // Return map of embedded languages
  return Object.fromEntries(entries);
}
