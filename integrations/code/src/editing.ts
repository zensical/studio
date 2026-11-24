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
import type { ExtensionContext, Range, TextDocument, TextEditor } from "vscode";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Edit that toggles emphasis for a selection or cursor.
 *
 * The resulting selection is given by offsets relative to the start of the
 * replacement text, and is a cursor when both offsets are equal.
 */
interface EmphasisEdit {
  range: Range;
  start: number;
  end: number;
  text: string;
  anchor: number;
  active: number;
}

/**
 * Emphasis width, i.e., the number of marker characters on each side - 1 for
 * italic (`*text*`), and 2 for bold (`**text**`).
 */
type EmphasisWidth = 1 | 2;

/* ----------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------- */

/**
 * Characters that can be used as emphasis markers - the first one is used
 * when inserting new markers.
 */
const MARKERS = ["*", "_"];

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Register editing commands for the extension.
 *
 * @param context - The extension context
 */
export function registerEditingCommands(context: ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zensicalStudio.toggleBold",
      () => toggleEmphasis(vscode.window.activeTextEditor, 2),
    ),
    vscode.commands.registerCommand(
      "zensicalStudio.toggleItalic",
      () => toggleEmphasis(vscode.window.activeTextEditor, 1),
    ),
  );
}

/**
 * Toggle emphasis for all selections in the editor.
 *
 * The behavior follows the Markdown All in One extension: selections are
 * wrapped or unwrapped, and cursors toggle the emphasis of the word they are
 * on, keeping their position within the word. A cursor right before closing
 * markers moves past them, so typing can continue without emphasis, and a
 * cursor that is not on a word inserts or removes an empty pair of markers.
 *
 * @param editor - Active text editor
 * @param width - Emphasis width
 */
async function toggleEmphasis(
  editor: TextEditor | undefined, width: EmphasisWidth,
): Promise<void> {
  if (
    typeof editor === "undefined" ||
    editor.document.isClosed ||
    editor.document.languageId !== "python-markdown"
  ) {
    return;
  }

  // Compute an edit for each selection, and drop edits that overlap with a
  // previous one, e.g., when multiple cursors are on the same word
  const { document } = editor;
  let last = -1;
  const edits = editor.selections
    .map((selection) => {
      if (!selection.isEmpty) {
        return toggleEdit(document, selection, width);
      }
      const caret = document.offsetAt(selection.active);
      const range = document.getWordRangeAtPosition(selection.active);
      return exitEdit(document, caret, width) ??
        toggleEdit(document, range ?? selection, width, caret);
    })
    .sort((a, b) => a.start - b.start)
    .filter((edit) => {
      if (edit.start < last) {
        return false;
      }
      last = edit.end;
      return true;
    });
  if (edits.length === 0) {
    return;
  }

  // Apply all edits in a single transaction, so that toggling the formatting
  // of all selections can be undone in one step
  try {
    const applied = await editor.edit((builder) => {
      for (const edit of edits) {
        builder.replace(edit.range, edit.text);
      }
    });
    if (!applied) {
      return;
    }
  } catch {
    return;
  }

  // Restore the selections, shifted by the length changes of previous edits
  let delta = 0;
  editor.selections = edits.map((edit) => {
    const start = edit.start + delta;
    delta += edit.text.length - (edit.end - edit.start);
    return new vscode.Selection(
      document.positionAt(start + edit.anchor),
      document.positionAt(start + edit.active),
    );
  });
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Compute the edit that moves a cursor past closing markers.
 *
 * This applies when the cursor is at the end of emphasized text, e.g., right
 * after typing into an empty pair of markers, as in `**text|**`. The cursor
 * is moved past the entire run of markers, and the text is left unchanged.
 *
 * @param document - Text document
 * @param offset - Cursor offset
 * @param width - Emphasis width
 *
 * @returns Cursor movement edit, or undefined if not applicable
 */
function exitEdit(
  document: TextDocument, offset: number, width: EmphasisWidth,
): EmphasisEdit | undefined {
  const { before, after } = surrounding(document, offset, offset);
  if (MARKERS.includes(before.slice(-1))) {
    return undefined;
  }

  // Move the cursor past the run of markers, if it denotes the emphasis
  for (const marker of MARKERS) {
    const run = leadingRun(after, marker);
    if (matches(run, width)) {
      const position = document.positionAt(offset);
      return {
        range: new vscode.Range(position, position),
        start: offset,
        end: offset,
        text: "",
        anchor: run,
        active: run,
      };
    }
  }
  return undefined;
}

/**
 * Compute the edit that toggles emphasis for a range.
 *
 * Markers are detected by the length of the run of marker characters, so
 * that bold and italic can be told apart and combined. Bold matches runs of
 * two or more characters, e.g., `**text**` or `***text***`, while italic
 * matches runs of odd length, e.g., `*text*` or `***text***`, but not the
 * markers of bold text, which is made bold and italic instead.
 *
 * When a cursor offset is given, the range is the word under the cursor, or
 * the empty range at the cursor, and the cursor keeps its position within
 * the word. Markers inside the word itself are not removed in this case, as
 * underscores are word characters, e.g., in `__init__`.
 *
 * @param document - Text document
 * @param range - Range to toggle
 * @param width - Emphasis width
 * @param caret - Cursor offset, if toggling from a cursor
 *
 * @returns Emphasis toggle edit
 */
function toggleEdit(
  document: TextDocument, range: Range, width: EmphasisWidth, caret?: number,
): EmphasisEdit {
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);
  const selected = document.getText(range);

  // Remove markers that are part of the selection itself
  if (typeof caret === "undefined") {
    for (const marker of MARKERS) {
      const run = leadingRun(selected, marker);
      if (
        run < selected.length &&
        matches(Math.min(run, trailingRun(selected, marker)), width)
      ) {
        const text = selected.slice(width, -width);
        return { range, start, end, text, anchor: 0, active: text.length };
      }
    }
  }

  // Remove markers surrounding the selection, which for an empty selection
  // removes an empty pair of markers around the cursor
  const { before, after } = surrounding(document, start, end);
  for (const marker of MARKERS) {
    const run = Math.min(
      trailingRun(before, marker),
      leadingRun(after, marker),
    );
    if (matches(run, width)) {
      const offset = typeof caret === "undefined" ? undefined : caret - start;
      return {
        range: new vscode.Range(
          document.positionAt(start - width),
          document.positionAt(end + width),
        ),
        start: start - width,
        end: end + width,
        text: selected,
        anchor: offset ?? 0,
        active: offset ?? selected.length,
      };
    }
  }

  // Wrap the selection in markers, which for an empty selection inserts an
  // empty pair of markers with the cursor between them. A cursor at the end
  // of a word is moved past the closing markers, so typing can continue
  const marker = MARKERS[0].repeat(width);
  const text = `${marker}${selected}${marker}`;
  if (typeof caret === "undefined") {
    return {
      range, start, end, text,
      anchor: width,
      active: width + selected.length,
    };
  }
  const offset = start < end && caret === end
    ? text.length
    : width + caret - start;
  return { range, start, end, text, anchor: offset, active: offset };
}

/**
 * Retrieve the text right before and after a range, which is enough to
 * determine the length of the runs of marker characters around it.
 *
 * @param document - Text document
 * @param start - Range start offset
 * @param end - Range end offset
 *
 * @returns Text before and after the range
 */
function surrounding(
  document: TextDocument, start: number, end: number,
): { before: string; after: string } {
  return {
    before: document.getText(new vscode.Range(
      document.positionAt(Math.max(0, start - 3)),
      document.positionAt(start),
    )),
    after: document.getText(new vscode.Range(
      document.positionAt(end),
      document.positionAt(end + 3),
    )),
  };
}

/**
 * Check whether a run of marker characters denotes the given emphasis.
 *
 * @param run - Length of the run of marker characters
 * @param width - Emphasis width
 *
 * @returns Whether the run denotes the emphasis
 */
function matches(run: number, width: EmphasisWidth): boolean {
  return width === 2 ? run >= 2 : run % 2 === 1;
}

/**
 * Count the number of marker characters at the start of a string.
 *
 * @param text - Text to inspect
 * @param marker - Marker character
 *
 * @returns Length of the run
 */
function leadingRun(text: string, marker: string): number {
  let run = 0;
  while (run < text.length && text[run] === marker) {
    run++;
  }
  return run;
}

/**
 * Count the number of marker characters at the end of a string.
 *
 * @param text - Text to inspect
 * @param marker - Marker character
 *
 * @returns Length of the run
 */
function trailingRun(text: string, marker: string): number {
  let run = 0;
  while (run < text.length && text[text.length - 1 - run] === marker) {
    run++;
  }
  return run;
}
