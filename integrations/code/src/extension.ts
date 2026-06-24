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

import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import { registerCommands } from "./commands";
import { createLanguageClient } from "./extension/client";
import { Context } from "./extension/context";
import { activateProjectMarkdown } from "./extension/project";
import { getStudio } from "./extension/studio";
import { NetworkError } from "./extension/studio/fetch";

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

/**
 * Language client.
 */
let client: LanguageClient | undefined;

/**
 * Startup timer.
 */
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Startup retry delay.
 */
let retryDelay = 5000;

/**
 * Whether startup is already in progress.
 */
let starting = false;

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

  // Register commands
  registerCommands(extension);
  extension.subscriptions.push(
    // The timer below is the primary recovery mechanism. These hooks only make
    // retry more responsive when the user returns to the window or opens a
    // Python Markdown document after VPN/proxy startup has completed.
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && typeof retryTimer !== "undefined") {
        void startStudio(context);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (
        document.languageId === "python-markdown" &&
        typeof retryTimer !== "undefined"
      ) {
        void startStudio(context);
      }
    }),
  );

  // Start Zensical Studio
  void startStudio(context);
}

/**
 * Deactivate extension.
 */
export async function deactivate(): Promise<void> {
  clearRetry();
  if (typeof client !== "undefined") {
    await client.stop();
    client = undefined;
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Start Zensical Studio.
 *
 * @param context - Context
 */
async function startStudio(context: Context): Promise<void> {
  if (typeof client !== "undefined" || starting) {
    return;
  }

  // Clear any scheduled retry
  clearRetry();
  starting = true;
  try {
    // Obtain Zensical studio configuration
    const studio = await getStudio(context);
    if (typeof studio === "undefined") {
      retryDelay = 5000;
      return;
    }

    // Create and start the language client
    retryDelay = 5000;
    context.log("Starting Zensical Studio");
    client = createLanguageClient(context, studio);
    client.start();
  } catch (error) {
    if (error instanceof NetworkError) {
      scheduleRetry(context);
      return;
    }

    // Log the error
    const message = error instanceof Error ? error.message : String(error);
    context.log(`Failed to start Zensical Studio: ${message}`);
  } finally {
    starting = false;
  }
}

/**
 * Schedule startup retry.
 *
 * @param context - Context
 */
function scheduleRetry(context: Context): void {
  const delay = retryDelay;
  const seconds = Math.round(delay / 1000);
  context.log(`Network unavailable; retrying in ${seconds}s`);

  // Schedule retry with exponential backoff and jitter
  retryTimer = setTimeout(() => {
    void startStudio(context);
  }, jitter(delay));
  retryDelay = Math.min(delay * 2, 5 * 60 * 1000);
}

/**
 * Clear scheduled startup retry.
 */
function clearRetry(): void {
  if (typeof retryTimer !== "undefined") {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
}

/**
 * Add jitter to a retry delay.
 *
 * @param delay - Delay in milliseconds
 *
 * @returns Jittered delay
 */
function jitter(delay: number): number {
  return Math.round(delay * (0.8 + Math.random() * 0.4));
}
