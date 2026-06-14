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

import {
  Executable,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

import type { Context } from "./context";
import type { Studio } from "./studio";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Create language client.
 *
 * @param context - Context
 * @param studio - Zensical Studio configuration
 *
 * @returns Language client
 */
export function createLanguageClient(
  context: Context,
  studio: Studio,
): LanguageClient {
  const run: Executable = {
    command: studio.path,
    args: ["server"],
  };

  // Initialize server options
  const serverOptions: ServerOptions = {
    run,
    debug: run,
  };

  // Initialize client options
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "python-markdown" }],
    outputChannel: context.output,
    initializationOptions: { token: studio.token },
  };

  // Create and return language client
  return new LanguageClient(
    "zensical",
    "Zensical Studio",
    serverOptions,
    clientOptions,
  );
}
