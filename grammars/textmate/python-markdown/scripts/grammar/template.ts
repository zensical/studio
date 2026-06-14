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

import type { EmbeddedLanguage } from "./languages.js";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Render template with embedded languages.
 *
 * @param template - Template string
 * @param languages - Embedded languages
 *
 * @returns Rendered template
 */
export function render(
  template: string,
  languages: EmbeddedLanguage[],
): string {
  const lines = template.split("\n");
  const output: string[] = [];

  // Process each line of the template
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // Check for @each directive
    const each = line.match(/^(\s*)# @each (\w+)\s*$/);
    if (!each) {
      output.push(line);
      continue;
    }

    // Process @each block
    const [, baseIndent, collectionName] = each;
    if (collectionName !== "languages") {
      throw new Error(`Unknown template collection '${collectionName}'`);
    }

    // Collect the block of lines until @end
    const block: string[] = [];
    index += 1;
    while (index < lines.length && !lines[index].match(/^\s*# @end\s*$/)) {
      block.push(lines[index]);
      index += 1;
    }

    // Ensure that the @each block is properly closed
    if (index >= lines.length) {
      throw new Error(`Unclosed @each block for '${collectionName}'`);
    }

    // Render the block for each language
    for (const language of languages) {
      const context = {
        ...language,
        aliases: renderAlternation(language.aliases),
      };

      // Render each line of the block with the current context
      for (const line of block) {
        output.push(renderLine(line, baseIndent, context));
      }
    }
  }

  // Join the output lines and return the rendered template
  return output.join("\n");
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Render a single line of the template with the given context.
 *
 * @param line - Line to render
 * @param indent - Indentation to apply
 * @param context - Context for template variables
 *
 * @returns Rendered line
 */
function renderLine(
  line: string,
  indent: string,
  context: Record<string, unknown>,
): string {
  const prefix = `${indent}# `;
  const output = line.startsWith(prefix)
    ? `${indent}${line.slice(prefix.length)}`
    : line;

  // Replace template variables in the line with values from the context
  return output.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = context[key];
    if (typeof value !== "string") {
      throw new Error(`Unknown template value '${key}'`);
    }
    return value;
  });
}

/**
 * Render an alternation of aliases for use in a regular expression.
 *
 * @param aliases - List of aliases to render
 *
 * @returns Rendered alternation string
 */
function renderAlternation(aliases: string[]): string {
  return aliases.map(escapeRegex).join("|");
}

/**
 * Escape special characters in a string for use in a regular expression.
 *
 * @param value - String to escape
 *
 * @returns Escaped string
 */
function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}
