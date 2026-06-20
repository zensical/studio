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
import { basename } from "node:path";

import type { Context } from "./context";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Project type.
 */
type Project = "MkDocs" | "Zensical";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Prompt to associate Markdown files with Python Markdown.
 *
 * @param context - Extension context
 */
export async function promptFileAssociation(context: Context): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length !== 1) {
    return;
  }

  // If we have a single workspace folder, check if it contains a project
  const [folder] = folders;
  const project = await findProject(folder);
  if (typeof project === "undefined") {
    return;
  }

  // Check, if we already prompted the user for this workspace
  const key = `association:${folder.uri.toString()}`;
  if (context.getState<boolean>(key) === true) {
    return;
  }

  // Check, if we already have an association for Markdown files to the
  // Python Markdown grammar in this workspace, and if so, skip
  const config = vscode.workspace.getConfiguration("files");
  const effective = config.get<Record<string, string>>("associations") ?? {};
  if (effective["*.md"] === "python-markdown") {
    context.setState(key, true);
    return;
  }

  // Prompt the user to associate Markdown files with Python Markdown
  const result = await vscode.window.showInformationMessage(
    `Detected ${project} project. ` +
      `Associate Markdown files in '${folder.name}' with Python Markdown?`,
    "Yes",
    "Not now",
  );

  // If the user dismissed the prompt, don't ask again
  if (typeof result === "undefined") {
    return;
  }

  if (result !== "Yes") {
    context.setState(key, true);
    return;
  }

  // Update file associations for this workspace
  const associations =
    config.inspect<Record<string, string>>("associations")?.workspaceValue ??
    {};
  try {
    await config.update(
      "associations",
      {
        ...associations,
        "*.md": "python-markdown",
      },
      vscode.ConfigurationTarget.Workspace,
    );
    context.setState(key, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.log(
      `Failed to update file associations for '${folder.name}': ${message}`,
    );
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Return the first matching project type in a workspace folder.
 *
 * @param folder - Workspace folder
 *
 * @returns Project type or nothing
 */
async function findProject(
  folder: vscode.WorkspaceFolder,
): Promise<Project | undefined> {
  const [match] = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/{mkdocs.yml,zensical.toml}"),
    null,
    1,
  );

  // Return the project type based on the matching file name
  switch (basename(match?.fsPath ?? "")) {
    case "zensical.toml":
      return "Zensical";
    case "mkdocs.yml":
      return "MkDocs";
  }

  // No matching project type found
  return;
}
