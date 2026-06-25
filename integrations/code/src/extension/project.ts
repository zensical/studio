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
import { basename, extname } from "node:path";

import type { Context } from "./context";
import type { ExtensionContext } from "vscode";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Project type.
 */
type Project = "MkDocs" | "Zensical";

/* ----------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------- */

/**
 * Tagged documents.
 */
const tagged = new Set<string>();

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Activate project-aware Markdown tagging.
 *
 * If a workspace folder contains an `mkdocs.yml` or `zensical.toml` file, open
 * Markdown files in that folder are treated as Python Markdown for the current
 * session. This makes it easier to work with Python Markdown in a project
 * context without requiring explicit configuration in the workspace settings.
 *
 * @param context - Extension context
 */
export async function activateProjectMarkdown(
  extension: ExtensionContext,
  context: Context,
): Promise<void> {
  let projects = await findProjects();
  await tagOpenDocuments(projects);

  // Tag newly opened Markdown files in detected project folders
  extension.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void tagDocument(document, projects);
    }),
  );

  // Re-scan project folders when the workspace shape changes
  extension.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      projects = await findProjects();
      await tagOpenDocuments(projects);
    }),
  );

  // Helper to refresh the list of detected project folders
  const refresh = async (): Promise<void> => {
    projects = await findProjects();
    await tagOpenDocuments(projects);
  };

  // Create a file system watcher to detect changes to project config files
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{mkdocs.yml,zensical.toml}",
  );
  watcher.onDidCreate(() => void refresh());
  watcher.onDidDelete(() => void refresh());
  watcher.onDidChange(() => void refresh());
  extension.subscriptions.push(watcher);

  // Log detected project folders
  context.log(
    projects.size > 0
      ? `Detected ${projects.size} Python Markdown project folder(s)`
      : "No Python Markdown project folders detected",
  );
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Find project folders in the current workspace.
 *
 * @returns Project folders
 */
async function findProjects(): Promise<Map<string, Project>> {
  const projects = new Map<string, Project>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const [match] = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/{mkdocs.yml,zensical.toml}"),
      null,
      1,
    );

    // Skip folders without a project config file
    switch (basename(match?.fsPath ?? "")) {
      case "zensical.toml":
        projects.set(folder.uri.toString(), "Zensical");
        break;
      case "mkdocs.yml":
        projects.set(folder.uri.toString(), "MkDocs");
        break;
    }
  }

  // Return detected project folders
  return projects;
}

/**
 * Tag all currently open Markdown documents inside detected project folders.
 *
 * @param projects - Project folders
 */
async function tagOpenDocuments(projects: Map<string, Project>): Promise<void> {
  for (const document of vscode.workspace.textDocuments) {
    await tagDocument(document, projects);
  }
}

/**
 * Tag a Markdown document as Python Markdown when appropriate.
 *
 * @param document - Text document
 * @param projects - Project folders
 */
async function tagDocument(
  document: vscode.TextDocument,
  projects: Map<string, Project>,
): Promise<void> {
  if (document.languageId !== "markdown") {
    return;
  }

  // Skip non-file documents and non-Markdown files
  if (
    document.uri.scheme !== "file" ||
    extname(document.uri.fsPath) !== ".md"
  ) {
    return;
  }

  // Skip documents outside of detected project folders
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (typeof folder === "undefined") {
    return;
  }

  // Skip documents in non-project folders
  if (!projects.has(folder.uri.toString())) {
    return;
  }

  // Tag the document as Python Markdown
  if (!tagged.has(document.uri.toString())) {
    tagged.add(document.uri.toString());
    await vscode.languages.setTextDocumentLanguage(document, "python-markdown");
  }
}
