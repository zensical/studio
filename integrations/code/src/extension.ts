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
import { release as getOsRelease } from "node:os";
import type { LanguageClient } from "vscode-languageclient/node";

import { registerCommands } from "./commands";
import { ConnectionsView } from "./connections";
import { createLanguageClient } from "./extension/client";
import { Context } from "./extension/context";
import { activateProjectMarkdown } from "./extension/project";
import {
  type RecoveryFailureKind,
  StudioRecovery,
} from "./extension/recovery";
import { getStudio } from "./extension/studio";
import type { Studio } from "./extension/studio";
import {
  ArchiveTransferError,
  NetworkError,
} from "./extension/studio/fetch";
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
 * Studio recovery state machine.
 */
const recovery = new StudioRecovery();

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
  recovery.reset();
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
      if (state.focused) {
        retryStudioOnActivity(extension, context);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === "markdown") {
        pending.set(document.uri.toString(), document);
      }
      if (document.languageId === "python-markdown") {
        retryStudioOnActivity(extension, context);
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
  recovery.reset();
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
      recoverStudioFailure(
        extension, context, "availability", "Studio unavailable",
      );
      return;
    }
    recovery.resolved();

    // Create and start the language client
    context.log("Starting Zensical Studio");
    next = createLanguageClient(context, studio, () => {
      setTimeout(() => {
        void recoverStudio(extension, context, next);
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
    if (error instanceof ArchiveTransferError) {
      recoverStudioFailure(
        extension, context, "download", "Studio download failed", error,
      );
    } else if (error instanceof NetworkError) {
      recoverStudioFailure(
        extension, context, "availability", "Network unavailable",
      );
    } else {
      recoverStudioFailure(
        extension, context, "startup", "Startup failed", message,
      );
    }
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
  recovery.reset();
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
async function recoverStudio(
  extension: ExtensionContext, context: Context,
  stopped: LanguageClient | undefined,
): Promise<void> {
  if (typeof stopped === "undefined" || client !== stopped) {
    return;
  }

  const serverProcess = stopped.serverProcess;
  const reason = describeServerStop(serverProcess);
  context.log(`Studio stopped unexpectedly: ${reason}`);
  client = undefined;
  clearRetryReset();
  disposeClientDisposables();
  stopped.dispose();
  await terminateServerProcess(serverProcess, context);
  if (recovery.beginRecovery()) {
    studio = undefined;
  }
  recoverStudioFailure(
    extension, context, "startup", "Studio stopped", reason,
  );
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
 * Recover from a Studio failure according to its policy.
 *
 * @param extension - Extension context
 * @param context - Context
 * @param kind - Failure kind
 * @param reason - Failure reason shown in the output channel
 * @param detail - Failure detail used for logging and diagnostics
 */
function recoverStudioFailure(
  extension: ExtensionContext, context: Context,
  kind: RecoveryFailureKind, reason: string,
  detail?: string | ArchiveTransferError,
): void {
  clearRetryReset();
  const decision = recovery.fail(kind);
  logStudioFailure(context, kind, decision.attempt, detail);
  if (decision.notify) {
    reportStudioFailure(context, kind, decision.attempt, detail);
  }
  if (!decision.retry) {
    context.log(
      `${reason}; automatic retries stopped after ${decision.attempt} attempts`,
    );
    return;
  }
  if (typeof retryTimer !== "undefined") {
    return;
  }
  const seconds = Math.round(decision.delay / 1000);
  context.log(`${reason}; retrying in ${seconds}s`);

  // Schedule retry with exponential backoff and jitter
  const retry = () => {
    retryTimer = undefined;
    if (starting) {
      retryTimer = setTimeout(retry, jitter(decision.delay));
      return;
    }
    if (!recovery.retry()) return;
    void startStudio(extension, context);
  };
  retryTimer = setTimeout(retry, jitter(decision.delay));
}

/**
 * Retry Studio early in response to editor activity.
 *
 * @param extension - Extension context
 * @param context - Context
 */
function retryStudioOnActivity(
  extension: ExtensionContext, context: Context,
): void {
  if (
    starting ||
    typeof retryTimer === "undefined" ||
    !recovery.retry(true)
  ) {
    return;
  }
  clearTimeout(retryTimer);
  retryTimer = undefined;
  void startStudio(extension, context);
}

/**
 * Log a Studio failure attempt.
 *
 * @param context - Context
 * @param kind - Failure kind
 * @param attempt - Failure attempt
 * @param detail - Failure detail
 */
function logStudioFailure(
  context: Context, kind: RecoveryFailureKind, attempt: number,
  detail?: string | ArchiveTransferError,
): void {
  switch (kind) {
    case "availability":
      context.log(`Availability attempt ${attempt} failed`);
      break;
    case "download":
      context.log(
        `Download attempt ${attempt} failed: ${singleLine(
          detail instanceof Error ? detail.message : String(detail),
        )}`,
      );
      break;
    case "startup":
      context.log(
        `Startup attempt ${attempt} failed: ${singleLine(String(detail))}`,
      );
      break;
  }
}

/**
 * Report a repeated Studio failure to the author.
 *
 * @param context - Context
 * @param kind - Failure kind
 * @param attempt - Failed attempt
 * @param detail - Failure detail
 */
function reportStudioFailure(
  context: Context, kind: RecoveryFailureKind, attempt: number,
  detail?: string | ArchiveTransferError,
): void {
  switch (kind) {
    case "availability":
      logStartupEnvironment(context);
      void context.promptStudioUnavailable();
      break;
    case "download":
      if (detail instanceof ArchiveTransferError) {
        const diagnostics = downloadDiagnostics(
          context, detail, attempt,
        );
        context.log(`Download diagnostics:\n${diagnostics}`);
        void context.promptStudioDownloadFailure(diagnostics);
      }
      break;
    case "startup":
      logStartupEnvironment(context);
      void context.promptStudioStartupFailure();
      break;
  }
}

/**
 * Reset restart backoff after the current client remains stable.
 */
function markStudioStable(): void {
  clearRetryReset();
  retryResetTimer = setTimeout(() => {
    retryResetTimer = undefined;
    recovery.reset();
  }, 3 * 60 * 1000);
}

/**
 * Log the environment needed for a startup issue report.
 *
 * @param context - Context
 */
function logStartupEnvironment(context: Context): void {
  const remote = vscode.env.remoteName ?? "local";
  const configured = context.getConfiguration().get<string>("path")?.trim();
  const version = configured
    ? "custom"
    : context.getState("version") ?? "unknown";
  context.log(
    "Startup environment: " +
      `extension=${context.getVersion()}, ` +
      `Studio=${version}, ` +
      `editor=${vscode.env.appName} ${vscode.version}, ` +
      `platform=${process.platform} ${getOsRelease()}/${process.arch}, ` +
      `remote=${remote}`,
  );
}

/**
 * Collect safe diagnostics for a Studio archive transfer failure.
 *
 * @param context - Context
 * @param error - Archive transfer error
 * @param attempt - Failed download attempt
 *
 * @returns Diagnostics
 */
function downloadDiagnostics(
  context: Context, error: ArchiveTransferError, attempt: number,
): string {
  const http = vscode.workspace.getConfiguration("http");
  const proxy = http.get<string>("proxy")?.trim();
  const noProxy = http.get<string[]>("noProxy") ?? [];
  const remote = vscode.env.remoteName ?? "local";
  const installed = context.getState("version") ?? "none";
  return [
    "Zensical Studio download diagnostics",
    `Timestamp: ${new Date().toISOString()}`,
    `Attempt: ${attempt}`,
    `Extension: ${context.getVersion()}`,
    `Installed Studio: ${installed}`,
    `Editor: ${vscode.env.appName} ${vscode.version}`,
    `Platform: ${process.platform} ${getOsRelease()}/${process.arch}`,
    `Remote: ${remote}`,
    `Configured proxy: ${Boolean(proxy)}`,
    `No-proxy entries: ${noProxy.length}`,
    `Proxy support: ${http.get("proxySupport", "unknown")}`,
    `Proxy strict SSL: ${http.get("proxyStrictSSL", "unknown")}`,
    `Fetch support: ${http.get("fetchAdditionalSupport", "unknown")}`,
    `Electron fetch: ${http.get("electronFetch", "unknown")}`,
    `System certificates: ${http.get("systemCertificates", "unknown")}`,
    `Node system certificates: ${http.get(
      "systemCertificatesNode", "unknown",
    )}`,
    `Local proxy configuration: ${http.get(
      "useLocalProxyConfiguration", "unknown",
    )}`,
    `HTTP proxy environment: ${environmentVariablePresent(
      "HTTP_PROXY", "http_proxy",
    )}`,
    `HTTPS proxy environment: ${environmentVariablePresent(
      "HTTPS_PROXY", "https_proxy",
    )}`,
    "",
    error.diagnostics,
  ].join("\n");
}

/**
 * Check whether any named environment variable has a non-empty value.
 *
 * @param names - Environment variable names
 *
 * @returns Whether a variable is present
 */
function environmentVariablePresent(...names: string[]): boolean {
  return names.some((name) => Boolean(process.env[name]));
}

/**
 * Describe how the server process stopped.
 *
 * @param serverProcess - Server process
 *
 * @returns Stop reason
 */
function describeServerStop(serverProcess: ChildProcess | undefined): string {
  if (!serverProcess) {
    return "language server connection closed";
  }
  if (serverProcess.signalCode !== null) {
    return `server process exited with signal ${serverProcess.signalCode}`;
  }
  if (serverProcess.exitCode !== null) {
    return `server process exited with code ${serverProcess.exitCode}`;
  }
  return "language server connection closed while the process was running";
}

/**
 * Collapse a failure reason into one log line.
 *
 * @param value - Failure reason
 *
 * @returns Single-line failure reason
 */
function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
