/*
 * Copyright (c) 2026 Zensical and contributors
 *
 * SPDX-License-Identifier: MIT
 * All contributions are certified under the DCO
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
import type { ExtensionContext, TextDocument } from "vscode";
import type { ChildProcess } from "node:child_process";
import type { LanguageClient } from "vscode-languageclient/node";

import { registerCommands } from "./commands";
import { createLanguageClient } from "./extension/client";
import { Context } from "./extension/context";
import { activateProjectMarkdown } from "./extension/project";
import { getStudio } from "./extension/studio";
import { NetworkError } from "./extension/studio/fetch";
import { WordCount } from "./word-count";

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

/**
 * Language client.
 */
let client: LanguageClient | undefined;

/** Editor-side prose statistics controller. */
let wordCount: WordCount | undefined;

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

/**
 * Markdown documents opened before Studio has provided project scopes.
 */
const pending = new Map<string, TextDocument>();

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
  wordCount = new WordCount(() => client);
  extension.subscriptions.push(wordCount);

  // Register commands
  registerCommands(
    extension,
    () => client,
    () => context.getOutput().show(),
    () => restartStudio(extension, context),
  );
  extension.subscriptions.push(
    // The timer below is the primary recovery mechanism. These hooks only make
    // retry more responsive when the user returns to the window or opens a
    // Python Markdown document after VPN/proxy startup has completed.
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && typeof retryTimer !== "undefined") {
        void startStudio(extension, context);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === "markdown") {
        pending.set(document.uri.toString(), document);
      }
      if (
        document.languageId === "python-markdown" &&
        typeof retryTimer !== "undefined"
      ) {
        void startStudio(extension, context);
      }
    }),
  );

  // Remember documents that may open before Studio has returned project
  // scopes. They are retagged as soon as the authoritative scopes arrive.
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === "markdown") {
      pending.set(document.uri.toString(), document);
    }
  }

  // Start Zensical Studio
  void startStudio(extension, context);
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
 * @param extension - Extension context
 * @param context - Context
 */
async function startStudio(
  extension: ExtensionContext, context: Context,
): Promise<void> {
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
    await client.start();
    extension.subscriptions.push(
      ...(await activateProjectMarkdown(
        context, client, pending,
      )),
    );
    wordCount?.refresh();
  } catch (error) {
    if (error instanceof NetworkError) {
      scheduleRetry(extension, context);
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
 * Stop the current server and start a fresh language client and process.
 *
 * @param extension - Extension context
 * @param context - Context
 */
async function restartStudio(
  extension: ExtensionContext, context: Context,
): Promise<void> {
  clearRetry();
  const previous = client;
  if (typeof previous === "undefined") {
    await startStudio(extension, context);
    return;
  }

  client = undefined;
  const serverProcess = previous.serverProcess;
  try {
    await previous.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.log(`Server shutdown failed: ${message}`);
  }

  await terminateServerProcess(serverProcess, context);
  previous.dispose();
  await startStudio(extension, context);
}

/** Terminate a server process that survived client shutdown. */
async function terminateServerProcess(
  serverProcess: ChildProcess | undefined, context: Context,
): Promise<void> {
  if (!serverProcess || typeof serverProcess.pid !== "number") {
    return;
  }

  if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
    context.log(`Terminating server process ${serverProcess.pid}`);
    serverProcess.kill();
    await waitForProcessExit(serverProcess, 1000);
  }

  if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
    context.log(`Force terminating server process ${serverProcess.pid}`);
    serverProcess.kill("SIGKILL");
    await waitForProcessExit(serverProcess, 1000);
  }
}

/** Wait briefly for a child process to exit. */
function waitForProcessExit(
  serverProcess: ChildProcess, timeout: number,
): Promise<void> {
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      serverProcess.removeListener("exit", onExit);
      resolve();
    }, timeout);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    serverProcess.once("exit", onExit);
  });
}

/**
 * Schedule startup retry.
 *
 * @param extension - Extension context
 * @param context - Context
 */
function scheduleRetry(
  extension: ExtensionContext, context: Context,
): void {
  const delay = retryDelay;
  const seconds = Math.round(delay / 1000);
  context.log(`Network unavailable; retrying in ${seconds}s`);

  // Schedule retry with exponential backoff and jitter
  retryTimer = setTimeout(() => {
    void startStudio(extension, context);
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
