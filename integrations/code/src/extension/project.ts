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
import { extname } from "node:path";

import type { Context } from "./context";
import type { LanguageClient } from "vscode-languageclient/node";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Workspace scopes returned by Studio.
 */
interface WorkspaceScopes {
  scopes: Array<{
    projectUri: string;
    roots: string[];
  }>;
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Activate project-aware Markdown tagging.
 *
 * @param context - Studio extension context
 * @param client - Started language client
 * @returns Subscriptions created by the project integration
 */
export async function activateProjectMarkdown(
  context: Context, client: LanguageClient,
): Promise<vscode.Disposable[]> {
  const handled = new Set<string>();
  const roots = new Map<string, string[]>();

  // Refresh governed Markdown roots for all workspace folders
  const refreshScopes = async (): Promise<void> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const responses = await Promise.all(
      folders.map(async (folder) => {
        try {
          const scopes = await client.sendRequest<WorkspaceScopes>(
            "zensical/workspace/scopes",
            { workspaceUri: folder.uri.toString() },
          );
          return [
            folder.uri.toString(),
            scopes.scopes.flatMap((scope) => scope.roots),
          ] as const;
        } catch (error) {
          context.log(
            `Failed to retrieve Markdown scopes for ${folder.uri}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [folder.uri.toString(), []] as [string, string[]];
        }
      }),
    );

    // Update managed Markdown roots
    roots.clear();
    for (const [folder, values] of responses) {
      roots.set(folder, values);
    }

    // Tag currently open Markdown documents inside managed roots
    await tagOpenDocuments(roots, handled);
    context.log(
      `Received ${responses.reduce((count, [, values]) => count + values.length, 0)} ` +
        "governed Markdown root(s)",
    );
  };

  // Subscribe to relevant events
  const subscriptions = [
    client.onNotification("zensical/workspace/scopesChanged", () => {
      void refreshScopes();
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void tagDocument(document, roots, handled);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await refreshScopes();
    }),
  ];

  // Initial refresh of managed Markdown roots
  await refreshScopes();
  return subscriptions;
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Tag currently open Markdown documents inside managed roots.
 *
 * @param roots - Manged Markdown roots by workspace folder
 * @param handled - Set of already handled document URIs
 */
async function tagOpenDocuments(
  roots: Map<string, string[]>,
  handled: Set<string>,
): Promise<void> {
  for (const document of vscode.workspace.textDocuments) {
    await tagDocument(document, roots, handled);
  }
}

/**
 * Tag a Markdown document as Python Markdown when appropriate.
 *
 * @param document - Text document
 * @param roots - Managed Markdown roots by workspace folder
 * @param handled - Set of already handled document URIs
 */
async function tagDocument(
  document: vscode.TextDocument,
  roots: Map<string, string[]>,
  handled: Set<string>,
): Promise<void> {
  // Skip non-file documents and non-Markdown files
  if (
    document.uri.scheme !== "file" ||
    extname(document.uri.fsPath) !== ".md"
  ) {
    return;
  }

  // Skip documents outside of a workspace folder
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (typeof folder === "undefined") {
    return;
  }

  // Skip documents that are not inside a managed root
  const folderRoots = roots.get(folder.uri.toString()) ?? [];
  if (!isManaged(document.uri, folderRoots)) {
    return;
  }

  // Skip documents that have already been handled
  const key = document.uri.toString();
  if (handled.has(key)) {
    return;
  }
  handled.add(key);

  // Skip documents that are already tagged as Python Markdown
  if (document.languageId !== "markdown") {
    return;
  }

  // Retag the document as Python Markdown
  await vscode.languages.setTextDocumentLanguage(document, "python-markdown");
}

/**
 * Check whether a document is inside one of the managed directory roots.
 *
 * @param uri - Document URI
 * @param roots - Managed directory URIs
 *
 * @returns Whether the document is managed
 */
function isManaged(uri: vscode.Uri, roots: string[]): boolean {
  return roots.some((root) => {
    const rootUri = vscode.Uri.parse(root);
    const rootPath = rootUri.path.endsWith("/")
      ? rootUri.path
      : `${rootUri.path}/`;

    // Check if the document URI matches the root URI scheme and authority, and
    // if the document path is equal to the root path or starts at the root
    return (
      uri.scheme === rootUri.scheme &&
      uri.authority === rootUri.authority &&
      (uri.path === rootUri.path || uri.path.startsWith(rootPath))
    );
  });
}
