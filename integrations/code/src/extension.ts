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
import type { Disposable, ExtensionContext, TextDocument } from "vscode";
import type { ChildProcess } from "node:child_process";
import type { LanguageClient } from "vscode-languageclient/node";

import { registerCommands } from "./commands";
import { ConnectionsView } from "./connections";
import { createLanguageClient } from "./extension/client";
import { Context } from "./extension/context";
import { activateProjectMarkdown } from "./extension/project";
import { getStudio } from "./extension/studio";
import type { Studio } from "./extension/studio";
import { NetworkError } from "./extension/studio/fetch";
import { WordCount } from "./word-count";

/* ----------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

/**
 * Language client.
 */
let client: LanguageClient | undefined;

/**
 * Runtime resolved for the current startup or recovery episode.
 */
let studio: Studio | undefined;

/**
 * Listeners owned by the current language client.
 */
let clientDisposables: Disposable[] = [];

/**
 * Editor-side prose statistics controller.
 */
let wordCount: WordCount | undefined;

/**
 * Sticky document relationships tree.
 */
let connections: ConnectionsView | undefined;

/**
 * Startup timer.
 */
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Whether editor activity may bring the current retry forward.
 */
let retryOnActivity = false;

/**
 * Whether Studio is recovering from an unexpected server stop.
 */
let recovering = false;

/**
 * Startup retry delay.
 */
let retryDelay = 5000;

/**
 * Timer that resets restart backoff after a stable session.
 */
let retryResetTimer: ReturnType<typeof setTimeout> | undefined;

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
  connections = new ConnectionsView(extension, () => client);

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
      if (
        state.focused &&
        typeof retryTimer !== "undefined" &&
        retryOnActivity
      ) {
        void startStudio(extension, context);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === "markdown") {
        pending.set(document.uri.toString(), document);
      }
      if (
        document.languageId === "python-markdown" &&
        typeof retryTimer !== "undefined" &&
        retryOnActivity
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
  clearRetryReset();
  disposeClientDisposables();
  const previous = client;
  client = undefined;
  if (typeof previous !== "undefined") {
    await previous.stop();
    previous.dispose();
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
  let next: LanguageClient | undefined;
  try {
    // Resolve once, then reuse the same runtime throughout this retry episode.
    studio ??= await getStudio(context);
    if (typeof studio === "undefined") {
      scheduleRetry(extension, context, "Studio unavailable", true);
      return;
    }

    // Create and start the language client
    context.log("Starting Zensical Studio");
    next = createLanguageClient(context, studio, () => {
      setTimeout(() => {
        recoverStudio(extension, context, next);
      }, 0);
    });
    client = next;
    await next.start();
    const disposables = await activateProjectMarkdown(
      context, next, pending,
    );
    if (client !== next) {
      for (const disposable of disposables) disposable.dispose();
      return;
    }
    disposeClientDisposables();
    clientDisposables = disposables;
    connections?.attachClient(next);
    wordCount?.refresh();
    markStudioStable();
  } catch (error) {
    if (typeof next !== "undefined") {
      if (client === next) client = undefined;
      disposeClientDisposables();
      const serverProcess = next.serverProcess;
      next.dispose();
      await terminateServerProcess(serverProcess, context);
    }

    // Log the error
    const message = error instanceof Error ? error.message : String(error);
    context.log(`Failed to start Zensical Studio: ${message}`);
    scheduleRetry(
      extension,
      context,
      error instanceof NetworkError ? "Network unavailable" : "Startup failed",
      error instanceof NetworkError,
    );
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
  clearRetryReset();
  retryDelay = 5000;
  recovering = false;
  studio = undefined;
  const previous = client;
  if (typeof previous === "undefined") {
    await startStudio(extension, context);
    return;
  }

  client = undefined;
  disposeClientDisposables();
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

/**
 * Recover from an unexpected server stop through normal startup resolution.
 *
 * @param extension - Extension context
 * @param context - Context
 * @param stopped - Language client that stopped unexpectedly
 */
function recoverStudio(
  extension: ExtensionContext, context: Context,
  stopped: LanguageClient | undefined,
): void {
  if (typeof stopped === "undefined" || client !== stopped) {
    return;
  }
  context.log("Studio stopped; preparing to restart");
  client = undefined;
  clearRetryReset();
  disposeClientDisposables();
  stopped.dispose();
  if (!recovering) {
    recovering = true;
    studio = undefined;
  }
  scheduleRetry(extension, context, "Studio stopped");
}

/**
 * Terminate a server process that survived client shutdown.
 *
 * @param serverProcess - Server process
 * @param context - Context
 */
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

/**
 * Wait briefly for a child process to exit.
 *
 * @param serverProcess - Server process
 * @param timeout - Timeout in milliseconds
 */
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
 * @param reason - Retry reason shown in the output channel
 * @param onActivity - Whether editor activity may bring the retry forward
 */
function scheduleRetry(
  extension: ExtensionContext, context: Context, reason: string,
  onActivity = false,
): void {
  if (typeof retryTimer !== "undefined") {
    return;
  }

  clearRetryReset();
  retryOnActivity = onActivity;
  const delay = retryDelay;
  const seconds = Math.round(delay / 1000);
  context.log(`${reason}; retrying in ${seconds}s`);

  // Schedule retry with exponential backoff and jitter
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (starting) {
      scheduleRetry(extension, context, reason);
      return;
    }
    void startStudio(extension, context);
  }, jitter(delay));
  retryDelay = Math.min(delay * 2, 5 * 60 * 1000);
}

/**
 * Reset restart backoff after the current client remains stable.
 */
function markStudioStable(): void {
  clearRetryReset();
  retryResetTimer = setTimeout(() => {
    retryResetTimer = undefined;
    retryDelay = 5000;
    recovering = false;
  }, 3 * 60 * 1000);
}

/**
 * Clear scheduled startup retry.
 */
function clearRetry(): void {
  if (typeof retryTimer !== "undefined") {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  retryOnActivity = false;
}

/**
 * Clear the restart-backoff reset timer.
 */
function clearRetryReset(): void {
  if (typeof retryResetTimer !== "undefined") {
    clearTimeout(retryResetTimer);
    retryResetTimer = undefined;
  }
}

/**
 * Dispose listeners owned by the current language client.
 */
function disposeClientDisposables(): void {
  for (const disposable of clientDisposables) disposable.dispose();
  clientDisposables = [];
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
