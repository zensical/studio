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
import type { Disposable } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import { getActivePreviewContext } from "./preview";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Document statistics returned by the language server.
 */
interface DocumentStats {
  uri: string;
  words: number;
  cjkUnits?: number;
  readingSeconds?: number;
  variant?: string;
}

/* ----------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------- */

const documentStats = "zensical/document/stats";
const REQUEST_DELAY = 200;
const WORDS_PER_MINUTE = 200;

/* ----------------------------------------------------------------------------
 * Class
 * ------------------------------------------------------------------------- */

/**
 * Shows visible prose statistics for the active Studio document.
 */
export class WordCount implements Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  private readonly disposables: Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  /**
   * Creates the word count status bar item.
   */
  public constructor(
    private readonly getClient: () => LanguageClient | undefined,
  ) {
    this.item.name = "Zensical Studio word count";
    this.disposables.push(
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          event.document === vscode.window.activeTextEditor?.document
        ) {
          this.refresh();
        }
      }),
    );
    this.refresh();
  }

  /**
   * Refreshes the word count status bar item.
   */
  public refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.update();
    }, REQUEST_DELAY);
  }

  /**
   * Disposes the item.
   */
  public dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
  }

  /**
   * Updates the word count status bar item.
   */
  private async update(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const client = this.getClient();
    if (!editor || editor.document.languageId !== "python-markdown" || !client) {
      this.item.hide();
      return;
    }

    // Increment generation to cancel any pending requests
    const uri = editor.document.uri.toString();
    const generation = ++this.generation;
    const preview = getActivePreviewContext(uri);
    const params = {
      uri,
      projections: preview?.projections ?? {},
      ...(preview?.variant ? { variant: preview.variant } : {}),
    };
    try {
      const result = await client.sendRequest<DocumentStats>(
        documentStats,
        params,
      );
      if (
        generation !== this.generation ||
        vscode.window.activeTextEditor?.document.uri.toString() !== uri
      ) {
        return;
      }
      const minutes = Math.ceil(getReadingSeconds(result) / 60);
      this.item.text = `$(book) ${formatNumber(result.words)} · ${minutes} min`;
      this.item.tooltip = undefined;
      this.item.show();
    } catch {
      if (generation === this.generation) {
        this.item.hide();
      }
    }
  }
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Formats a number with commas as thousands separators.
 *
 * @param value - Number to format
 *
 * @returns Formatted number
 */
function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Calculates the reading time in seconds.
 *
 * @param stats - Document statistics
 *
 * @returns Reading time in seconds
 */
function getReadingSeconds(stats: DocumentStats): number {
  return stats.readingSeconds ?? Math.ceil(stats.words / WORDS_PER_MINUTE) * 60;
}
