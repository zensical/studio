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

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/** Read-only Markdown notes, separate from project documents and the LSP. */
const uri = vscode.Uri.parse("zensical-studio-note:/studio.md");
let markdown = "";
let changes: vscode.EventEmitter<vscode.Uri> | undefined;

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Register VS Code's existing Markdown preview as the note renderer.
 *
 * @param extension - Extension context
 */
export function registerNote(extension: ExtensionContext): void {
  changes = new vscode.EventEmitter<vscode.Uri>();
  extension.subscriptions.push(changes,
    vscode.workspace.registerTextDocumentContentProvider(uri.scheme, {
      onDidChange: changes.event,
      provideTextDocumentContent: resource => {
        if (resource.toString() !== uri.toString()) {
          throw new Error("Unknown Studio note");
        }
        return markdown;
      },
    }),
  );
}

/**
 * Open the supplied document as a locked preview, preserving normal security.
 *
 * @param content - Markdown content to display
 */
export async function showNote(content: string): Promise<void> {
  markdown = content;
  changes?.fire(uri);
  await vscode.commands.executeCommand("markdown.showPreview", uri, undefined, {
    locked: true,
  });
}
