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
import type {
  ExtensionContext,
  LogOutputChannel,
  WorkspaceConfiguration,
} from "vscode";

/* ----------------------------------------------------------------------------
 * Class
 * ------------------------------------------------------------------------- */

/**
 * Context for Zensical Studio extension.
 */
export class Context {
  /** Output channel */
  private readonly output: LogOutputChannel;
  /** Extension context */
  private readonly context: ExtensionContext;

  /**
   * Create context.
   */
  public constructor(extension: ExtensionContext) {
    this.context = extension;
    this.output = vscode.window.createOutputChannel("Zensical Studio", {
      log: true,
    });
    this.context.subscriptions.push(this.output);
  }

  /**
   * Get extension configuration.
   *
   * @returns Extension configuration
   */
  public getConfiguration(): WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("zensical.studio");
  }

  /**
   * Get extension version.
   *
   * @returns Extension version
   */
  public getVersion(): string {
    return this.context.extension.packageJSON.version;
  }

  /**
   * Get extension storage path.
   *
   * @returns Storage path
   */
  public getStorage(): string {
    return this.context.globalStorageUri.fsPath;
  }

  /**
   * Get output channel.
   *
   * @returns Output channel
   */
  public getOutput(): LogOutputChannel {
    return this.output;
  }

  /**
   * Get extension state for a given key.
   *
   * @param key - Key
   *
   * @returns Value or nothing
   */
  public getState<T = string>(key: string): T | undefined {
    return this.context.globalState.get<T>(key);
  }

  /**
   * Set extension state for a given key.
   *
   * @param key - Key
   * @param value - Value
   */
  public setState<T = string>(key: string, value: T) {
    void this.context.globalState.update(key, value);
  }

  /**
   * Append a message to the output channel.
   *
   * @param message - Message
   */
  public log(message: string) {
    this.output.appendLine(message);
  }

  /**
   * Show an error message to the user.
   *
   * @param message - Message
   */
  public showError(message: string) {
    void show("error", message);
  }

  /**
   * Show a warning message to the user.
   *
   * @param message - Message
   */
  public showWarning(message: string) {
    void show("warning", message);
  }

  /**
   * Show an info message to the user.
   *
   * @param message - Message
   */
  public showInfo(message: string) {
    void show("info", message);
  }

  /**
   * Explain that Studio remains unavailable after several attempts.
   */
  public async promptStudioUnavailable(): Promise<void> {
    const action = "Show Logs";
    const result = await vscode.window.showWarningMessage(
      "Zensical Studio is still unavailable. Check your network connection " +
        "and configured Studio path. Studio will keep retrying.",
      action,
    );
    if (result === action) {
      this.output.show();
    }
  }

  /**
   * Explain a repeated startup failure and offer a reporting path.
   */
  public async promptStudioStartupFailure(): Promise<void> {
    const logs = "Show Logs";
    const report = "Report Issue";
    const result = await vscode.window.showErrorMessage(
      "Zensical Studio could not be started after several attempts. " +
        "Automatic retries have stopped. Use Zensical Studio: Restart Server " +
        "to try again. " +
        "If the problem persists, report an issue and include the Studio logs.",
      logs,
      report,
    );
    if (result === logs) {
      this.output.show();
    } else if (result === report) {
      this.output.show();
      await vscode.env.openExternal(vscode.Uri.parse(
        "https://github.com/zensical/studio/issues/new" +
          "?template=01-report-a-bug.yml" +
          "&title=Studio%20fails%20to%20start",
      ));
    }
  }

  /**
   * Prompt the user to update the extension.
   *
   * @param message - Message
   */
  public async promptUpdate(message: string): Promise<void> {
    const action = "Open Extension";
    const result = await show("error", message, true, action);
    if (result === action) {
      await vscode.commands.executeCommand(
        "extension.open",
        this.context.extension.id,
      );
    }
  }
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Show a message to the user.
 *
 * @param kind - Kind of message
 * @param message - Message
 * @param modal - Whether the message should be modal
 * @param action - Optional action to show in the message
 */
function show(
  kind: "error" | "warning" | "info",
  message: string,
  modal = false,
  action?: string,
): Thenable<string | undefined> {
  switch (kind) {
    case "error":
      return typeof action === "undefined"
        ? vscode.window.showErrorMessage(message, { modal })
        : vscode.window.showErrorMessage(message, { modal }, action);
    case "warning":
      return typeof action === "undefined"
        ? vscode.window.showWarningMessage(message, { modal })
        : vscode.window.showWarningMessage(message, { modal }, action);
    default:
      return typeof action === "undefined"
        ? vscode.window.showInformationMessage(message, { modal })
        : vscode.window.showInformationMessage(message, { modal }, action);
  }
}
