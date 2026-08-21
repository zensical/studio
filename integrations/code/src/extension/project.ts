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
import type { Disposable, TextDocument } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { extname } from "node:path";

import type { Context } from "./context";
import { isUriInside } from "./project-path";

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

/**
 * State for one document lifecycle.
 */
interface DocumentState {
  languageId: string;
  automaticallyTagged: boolean;
  userOverride: boolean;
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
  pending = new Map<string, TextDocument>(),
): Promise<Disposable[]> {
  const openDocuments = new Map<string, DocumentState>();
  const changingLanguage = new Set<string>();
  const roots = new Map<string, string[]>();

  // Refresh managed Markdown roots for all workspace folders
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
    await tagOpenDocuments(
      roots, openDocuments, changingLanguage, pending,
    );
    context.log(
      `Received ${responses.reduce((count, [, values]) => count + values.length, 0)} ` +
        "managed Markdown root(s)",
    );
  };

  // Register event listeners for workspace changes and document lifecycle
  const subscriptions: Disposable[] = [
    client.onNotification("zensical/workspace/scopesChanged", () => {
      void refreshScopes();
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void tagDocument(document, roots, openDocuments, changingLanguage);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();

      // A language change may emit close/open events while the URI remains
      // open. Defer cleanup until VS Code has updated its document collection.
      setTimeout(() => {
        if (
          changingLanguage.has(key) ||
          vscode.workspace.textDocuments.some(
            (open) => open.uri.toString() === key,
          )
        ) {
          return;
        }

        // Remove document state when the document is closed and not reopened
        openDocuments.delete(key);
      }, 0);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await refreshScopes();
    }),
  ];

  // Register listeners before the initial request so document events cannot
  // be lost while Studio is calculating the scopes.
  await refreshScopes();
  return subscriptions;
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Tag currently open Markdown documents inside governed roots.
 *
 * @param roots - Managed Markdown roots by workspace folder
 * @param documents - Per-document lifecycle state
 * @param changingLanguage - Language changes initiated by this extension
 * @param pending - Documents that opened before Studio returned project scopes
 */
async function tagOpenDocuments(
  roots: Map<string, string[]>,
  documents: Map<string, DocumentState>,
  changingLanguage: Set<string>,
  pending: Map<string, TextDocument>,
): Promise<void> {
  const openDocuments = new Map(
    [...vscode.workspace.textDocuments, ...pending.values()]
      .map((document) => [document.uri.toString(), document] as const),
  );
  for (const document of openDocuments.values()) {
    await tagDocument(document, roots, documents, changingLanguage);
  }
  pending.clear();
}

/**
 * Tag a Markdown document as Python Markdown when appropriate.
 *
 * @param document - Text document
 * @param roots - Managed Markdown roots by workspace folder
 * @param documents - Per-document lifecycle state
 * @param changingLanguage - Language changes initiated by this extension
 */
async function tagDocument(
  document: TextDocument,
  roots: Map<string, string[]>,
  openDocuments: Map<string, DocumentState>,
  changingLanguage: Set<string>,
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

  // Initialize document state if it doesn't exist yet
  let state = openDocuments.get(key);
  if (typeof state === "undefined") {
    state = {
      languageId: document.languageId,
      automaticallyTagged: false,
      userOverride: false,
    };
      openDocuments.set(key, state);
  }

  // Ignore the language event caused by our own retagging.
  if (changingLanguage.has(key)) {
    state.languageId = document.languageId;
    return;
  }

  // A language change on an open document is an explicit user decision.
  if (state.languageId !== document.languageId) {
    state.languageId = document.languageId;
    if (document.languageId === "markdown") {
      state.userOverride = true;
    }
    return;
  }

  // Skip documents that are already tagged or not Markdown
  if (
    state.userOverride ||
    state.automaticallyTagged ||
    document.languageId !== "markdown"
  ) {
    return;
  }

  // Tag the document as Python Markdown
  changingLanguage.add(key);
  try {
    await vscode.languages.setTextDocumentLanguage(document, "python-markdown");
    state.languageId = "python-markdown";
    state.automaticallyTagged = true;
  } finally {
    changingLanguage.delete(key);
  }
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
  return roots.some((root) => isUriInside(uri, vscode.Uri.parse(root)));
}
