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
import type {
  ExtensionContext,
  OutputChannel,
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
  private readonly output: OutputChannel;
  /** Extension context */
  private readonly context: ExtensionContext;

  /**
   * Create context.
   */
  public constructor(extension: ExtensionContext) {
    this.context = extension;
    this.output = vscode.window.createOutputChannel("Zensical Studio");
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
  public getOutput(): OutputChannel {
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
