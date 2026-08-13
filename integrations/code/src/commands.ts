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
import type { ExtensionContext } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { Location, Position } from "vscode-languageserver-types";

import { registerPreviewCommand } from "./preview";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Register commands for the extension.
 *
 * @param context - The extension context
 */
export function registerCommands(
  context: ExtensionContext,
  getClient: () => LanguageClient | undefined,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zensical.showReferences",
      async (uri: string, position: Position, locations: Location[]) => {
        await vscode.commands.executeCommand(
          "editor.action.showReferences",
          vscode.Uri.parse(uri),
          toPosition(position),
          locations.map(toLocation),
        );
      },
    ),
    vscode.commands.registerCommand("zensicalStudio.restartServer", async () => {
      const client = getClient();
      if (!client) {
        void vscode.window.showInformationMessage(
          "Zensical Studio is not running.",
        );
        return;
      }

      try {
        await client.restart();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
          `Zensical Studio: Unable to restart server: ${message}`,
        );
      }
    }),
  );
  registerPreviewCommand(context, getClient);
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Convert an LSP location to a location.
 *
 * @param location - LSP location
 *
 * @returns Location
 */
function toLocation(location: Location): vscode.Location {
  return new vscode.Location(
    vscode.Uri.parse(location.uri),
    new vscode.Range(
      toPosition(location.range.start),
      toPosition(location.range.end),
    ),
  );
}

/**
 * Convert an LSP position to a position.
 *
 * @param position - LSP position
 *
 * @returns Position
 */
function toPosition(position: Position): vscode.Position {
  return new vscode.Position(position.line, position.character);
}
