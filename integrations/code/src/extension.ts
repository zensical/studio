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

import type { ExtensionContext } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import { registerCommands } from "./commands";
import { createLanguageClient } from "./extension/client";
import { Context } from "./extension/context";
import { activateProjectMarkdown } from "./extension/project";
import { getStudio } from "./extension/studio";

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

/**
 * Language client.
 */
let client: LanguageClient | undefined;

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Activate extension.
 *
 * @param extension - Extension context
 */
export async function activate(extension: ExtensionContext): Promise<void> {
  const context = new Context(extension);
  void activateProjectMarkdown(extension, context);

  // Obtain Zensical studio configuration
  const studio = await getStudio(context);
  if (typeof studio === "undefined") {
    return;
  }

  // Register commands
  registerCommands(extension);

  // Create and start the language client
  context.log("Starting Zensical Studio");
  try {
    client = createLanguageClient(context, studio);
    client.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.log(`Failed to start Zensical Studio: ${message}`);
  }
}

/**
 * Deactivate extension.
 */
export async function deactivate(): Promise<void> {
  if (typeof client !== "undefined") {
    await client.stop();
    client = undefined;
  }
}
