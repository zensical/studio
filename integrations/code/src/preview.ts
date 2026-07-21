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
import { readFileSync } from "node:fs";
import type { ExtensionContext } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Mapping kind.
 */
type MappingKind  =
  | "text"
  | "escapedText"
  | "rawHtmlText"
  | "attributeValue"
  | "whitespace"

/**
 * Mapping target for a rendered HTML range.
 */
type MappingTarget =
  | { type: "direct"; spans: Span }
  | { type: "split"; spans: Span[] };

 /* ------------------------------------------------------------------------ */

/**
 * Preview update from Zensical Studio.
 */
interface PreviewUpdate {
  session: string;
  uri: string;
  version: number;
  html: string;
  mappings: MappingSegment[];
};

/**
 * Mapping segment correlating a rendered HTML range with Markdown.
 */
interface MappingSegment {
  htmlStart: number;
  htmlEnd: number;
  markdown: MappingTarget;
  kind: MappingKind;
};

/**
 * Byte range in source document.
 */
interface Span {
  uri: string;
  start: number;
  end: number;
};

/**
 * Position in the source document corresponding to a rendered HTML range.
 */
interface Position {
  sourceOffset: number;
  sourceLineStart: number;
  sourceLineEnd: number;
};

/**
 * Response returned when a preview session is started.
 */
interface PreviewStartResult {
  session: string;
  url: string;
  initialUpdate: PreviewUpdate;
};

/**
 * A local link resolved against the active Markdown document.
 */
interface ResolvedLocalLink {
  uri: vscode.Uri;
  fragment?: string;
}

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

// LSP notification for preview updates.
const previewStart = "zensical/preview/start";
const previewStop = "zensical/preview/stop";
const previewUpdate = "zensical/preview/update";

/* ----------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------- */

/**
 * Active preview panel.
 */
let activePanel: vscode.WebviewPanel | undefined;

/**
 * Active preview session.
 */
let activeSession: string | undefined;

/**
 * Disposable for the preview update notification.
 */
let notificationDisposable: vscode.Disposable | undefined;

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Register the preview command for the extension.
 *
 * @param context - The extension context
 * @param getClient - Function to get the language client
 */
export function registerPreviewCommand(
  context: ExtensionContext, getClient: () => LanguageClient | undefined,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("zensical.preview.open", async () => {
      const editor = vscode.window.activeTextEditor;
      const client = getClient();
      if (!editor || !client) return;

      // If a preview panel is already open, reveal it
      if (activePanel) {
        activePanel.reveal(vscode.ViewColumn.Beside);
        return;
      }

      // Create a new webview panel for the preview
      const panel = vscode.window.createWebviewPanel(
        "zensicalPreview",
        "Zensical Preview",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            context.extensionUri,
            ...(vscode.workspace.workspaceFolders?.map(
              (folder) => folder.uri,
            ) ?? []),
          ],
        },
      );

      // Set the active panel and initialize the webview content
      activePanel = panel;
      panel.webview.html = previewHtml(panel.webview, context.extensionUri);

      // Handle preview updates and editor interactions
      let disposed = false;
      let activeUri: string | undefined;
      let pendingDocument: vscode.TextDocument | undefined;
      let startingUri: string | undefined;
      let switching = false;
      let switchGeneration = 0;
      let latestVersion = -1;
      let latestUpdate: PreviewUpdate | undefined;
      let updateTimer: ReturnType<typeof setTimeout> | undefined;

      // Accept only updates for the active session, then debounce the web view
      // replacement so rapid editor changes do not trigger a DOM rebuild each
      notificationDisposable = client.onNotification(
        previewUpdate, (update: PreviewUpdate) => {
          // Ignore updates for inactive sessions or older versions
          if (
            update.session !== activeSession ||
            update.version <= latestVersion
          ) {
            return;
          }

          // Debounce updates to avoid excessive DOM rebuilds in the web view
          latestVersion = update.version;
          latestUpdate = update;
          if (updateTimer) clearTimeout(updateTimer);
          updateTimer = setTimeout(() => {
            updateTimer = undefined;
            const current = latestUpdate;
            if (!current || current.version < latestVersion) return;
            void panel.webview
              .postMessage({
                type: "preview/update",
                update: withPreviewBase(panel.webview, current),
              });
          }, 100);
        },
      );

      // Dispose of the panel and clean up resources when it is closed
      panel.onDidDispose(() => {
        disposed = true;
        switchGeneration += 1;
        pendingDocument = undefined;
        const session = activeSession;
        activePanel = undefined;
        activeSession = undefined;
        activeUri = undefined;
        notificationDisposable?.dispose();
        notificationDisposable = undefined;
        if (updateTimer) clearTimeout(updateTimer);
        if (session) void client.sendNotification(previewStop, { session });
      }, undefined, context.subscriptions);

      // Handle editor selection changes
      const selectionDisposable =
        vscode.window.onDidChangeTextEditorSelection((event) => {
          if (
            event.textEditor.document.uri.toString() !== activeUri ||
            !latestUpdate
          ) {
            return;
          }

          // Translate the editor's cursor position to source offset
          const position = previewPosition(
            event.textEditor.document,
            event.textEditor.selection.active,
          );
          void panel.webview.postMessage({
            type: "preview/highlight",
            ...position,
          });
          if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
            void panel.webview.postMessage({
              type: "preview/reveal",
              ...position,
            });
          }
        });

      // Dispose of the selection listener when the panel is closed
      panel.onDidDispose(() => selectionDisposable.dispose());

      // Handle messages from the web view, such as link clicks
      panel.webview.onDidReceiveMessage(
        async (message: {
          type?: string;
          href?: string;
          uri?: string;
          end?: number;
        }) => {
          if (message.type === "preview/reveal-source") {
            if (
              !message.uri ||
              message.uri !== activeUri ||
              typeof message.end !== "number"
            ) {
              return;
            }
            try {
              const uri = vscode.Uri.parse(message.uri);
              const document = await vscode.workspace.openTextDocument(uri);
              const editor = await vscode.window.showTextDocument(document, {
                preview: true,
                preserveFocus: false,
                viewColumn:
                  vscode.window.activeTextEditor?.viewColumn ??
                  vscode.ViewColumn.One,
              });
              const position = document.positionAt(
                utf16OffsetAtByteOffset(document.getText(), message.end),
              );
              editor.selection = new vscode.Selection(position, position);
              editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport,
              );
              postEditorPosition(editor, true);
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error);
              void vscode.window.showErrorMessage(
                `Unable to reveal preview source: ${detail}`,
              );
            }
            return;
          }
          if (
            message.type !== "preview/open-link" ||
            !message.href || !activeUri
          ) {
            return;
          }

          // Resolve the clicked link relative to the active document
          const link = resolveLocalLink(activeUri, message.href);
          if (!link) return;
          try {
            const document = await vscode.workspace.openTextDocument(link.uri);
            await vscode.window.showTextDocument(document, {
              preview: true,
              preserveFocus: false,
              viewColumn:
                vscode.window.activeTextEditor?.viewColumn ??
                vscode.ViewColumn.One,
            });
            if (link.fragment) {
              void panel.webview.postMessage({
                type: "preview/reveal-fragment",
                fragment: link.fragment,
                uri: link.uri.toString(),
              });
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(
              `Unable to open preview link: ${detail}`,
            );
          }
        },
        undefined,
        context.subscriptions,
      );

      // Post the current editor position to the web view for highlighting
      const postEditorPosition = (
        editor: vscode.TextEditor | undefined,
        reveal: boolean,
      ) => {
        if (
          !editor ||
          editor.document.uri.toString() !== activeUri ||
          !latestUpdate
        ) {
          return;
        }

        // Re-apply the cursor mapping after a document switch
        const position = previewPosition(
          editor.document,
          editor.selection.active,
        );
        void panel.webview.postMessage({
          type: "preview/highlight",
          ...position,
        });
        if (reveal) {
          void panel.webview.postMessage({
            type: "preview/reveal",
            ...position,
            force: true,
          });
        }
      };

      // Request a switch to a new document for previewing
      const requestSwitch = (document: vscode.TextDocument) => {
        const uri = document.uri.toString();
        if (disposed || document.languageId !== "python-markdown") return;
        if (
          activeUri === uri &&
          activeSession &&
          !pendingDocument
        ) {
          // Re-apply the current cursor position when returning to the active document.
          postEditorPosition(vscode.window.activeTextEditor, true);
          return;
        }
        if (startingUri === uri && !pendingDocument) {
          return;
        }

        // Keep only the newest requested document
        pendingDocument = document;
        switchGeneration += 1;
        if (!switching) void drainSwitches();
      };

      // Drain the queue of pending document switches
      const drainSwitches = async (): Promise<void> => {
        if (switching) return;
        switching = true;
        try {
          while (!disposed && pendingDocument) {
            const document = pendingDocument;
            pendingDocument = undefined;
            const uri = document.uri.toString();
            const generation = switchGeneration;
            startingUri = uri;

            if (activeUri === uri && activeSession) {
              startingUri = undefined;
              continue;
            }

            // Stop the old session before re-rendering
            const previousSession = activeSession;
            activeSession = undefined;
            activeUri = undefined;
            latestVersion = -1;
            latestUpdate = undefined;
            if (updateTimer) {
              clearTimeout(updateTimer);
              updateTimer = undefined;
            }
            if (previousSession) {
              await client.sendNotification(previewStop, {
                session: previousSession,
              });
            }

            // Start a new preview session for the requested document
            let result: PreviewStartResult;
            try {
              result = await client.sendRequest<PreviewStartResult>(
                previewStart,
                { uri, projections: {} },
              );
            } catch (error) {
              startingUri = undefined;
              if (!disposed && generation === switchGeneration) {
                const message = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(
                  `Unable to start Zensical Preview: ${message}`,
                );
              }
              continue;
            }

            // A newer editor selection may have arrived
            if (
              disposed ||
              generation !== switchGeneration ||
              pendingDocument
            ) {
              startingUri = undefined;
              void client.sendNotification(previewStop, {
                session: result.session,
              });
              continue;
            }

            // Update the active session and send the initial preview update
            activeSession = result.session;
            activeUri = uri;
            startingUri = undefined;
            latestVersion = result.initialUpdate.version;
            latestUpdate = result.initialUpdate;
            void panel.webview.postMessage({
              type: "preview/update",
              update: withPreviewBase(panel.webview, result.initialUpdate),
            });
            postEditorPosition(vscode.window.activeTextEditor, true);
          }
        } finally {
          switching = false;
          if (!disposed && pendingDocument) void drainSwitches();
        }
      };

      // Listen for active editor changes and document opens
      const activeEditorDisposable =
        vscode.window.onDidChangeActiveTextEditor((nextEditor) => {
          if (nextEditor) requestSwitch(nextEditor.document);
        });

      // Listen for documents being opened and request a switch
      const openedDocumentDisposable = vscode.workspace.onDidOpenTextDocument(
        (document) => {
          setTimeout(() => {
            const nextEditor = vscode.window.activeTextEditor;
            if (
              nextEditor?.document.uri.toString() === document.uri.toString()
            ) {
              requestSwitch(nextEditor.document);
            }
          }, 100);
        },
      );

      // Dispose of the listeners when the panel is closed
      panel.onDidDispose(() => activeEditorDisposable.dispose());
      panel.onDidDispose(() => openedDocumentDisposable.dispose());
      requestSwitch(editor.document);
    }),
  );
}

/* ------------------------------------------------------------------------- */

/**
 * Generate the HTML content for the preview webview.
 *
 * @param webview - The webview instance
 * @param extensionUri - The URI of the extension
 *
 * @returns The HTML content as a string
 */
function previewHtml(
  webview: vscode.Webview, extensionUri: vscode.Uri,
): string {
  const nonce = [...Array(32)]
    .map(() => Math.random().toString(36)[2])
    .join("");
  const stylesheet = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "preview.css"),
  );
  const palette = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "palette.css"),
  );
  const katex = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "katex.min.js"),
  );
  const katexStylesheet = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "katex.min.css"),
  );
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: https:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `base-uri ${webview.cspSource}`,
    "form-action 'none'",
  ].join("; ");
  const template = readFileSync(
    vscode.Uri.joinPath(extensionUri, "media", "preview.html").fsPath,
    "utf8",
  );
  return template
    .replaceAll("__CSP__", csp)
    .replaceAll("__NONCE__", nonce)
    .replaceAll("__STYLESHEET__", stylesheet.toString())
    .replaceAll("__PALETTE__", palette.toString())
    .replaceAll("__KATEX__", katex.toString())
    .replaceAll("__KATEX_STYLESHEET__", katexStylesheet.toString());
}

/**
 * Resolve a local link relative to a base URI.
 *
 * @param baseUri - The base URI of the current document
 * @param href - The href of the link to resolve
 *
 * @returns The resolved VS Code URI, or undefined
 */
function resolveLocalLink(
  baseUri: string, href: string
): ResolvedLocalLink | undefined {
  try {
    const url = new URL(href, baseUri);
    if (url.protocol !== "file:") return undefined;
    const fragment = url.hash.slice(1) || undefined;
    url.hash = "";
    url.search = "";
    return { uri: vscode.Uri.parse(url.toString()), fragment };
  } catch {
    return undefined;
  }
}

/**
 * Convert a UTF-8 byte offset to the UTF-16 offset used by VS Code positions.
 *
 * @param text - Document text
 * @param byteOffset - UTF-8 byte offset
 *
 * @returns UTF-16 offset
 */
function utf16OffsetAtByteOffset(text: string, byteOffset: number): number {
  return Buffer.from(text, "utf8")
    .subarray(0, byteOffset)
    .toString("utf8")
    .length;
}

/**
 * Convert a VS Code position to a source position for preview mapping.
 *
 * @param document - The text document
 * @param position - The position in the document
 *
 * @returns The corresponding source position for preview mapping
 */
function previewPosition(
  document: vscode.TextDocument, position: vscode.Position,
): Position {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const line = document.lineAt(position.line);
  const lineStart = document.offsetAt(new vscode.Position(position.line, 0));
  const lineEnd = document.offsetAt(
    new vscode.Position(position.line, line.text.length),
  );
  return {
    sourceOffset: Buffer.byteLength(text.slice(0, offset), "utf8"),
    sourceLineStart: Buffer.byteLength(text.slice(0, lineStart), "utf8"),
    sourceLineEnd: Buffer.byteLength(text.slice(0, lineEnd), "utf8"),
  };
}

/**
 * Augment a preview update with a base URI for resolving relative links.
 *
 * @param webview - The webview instance
 * @param update - The preview update from Zensical Studio
 *
 * @returns The augmented preview update with a base URI
 */
function withPreviewBase(
  webview: vscode.Webview, update: PreviewUpdate,
): PreviewUpdate & { baseUri: string } {
  const documentUri = vscode.Uri.parse(update.uri);
  const directoryUri = vscode.Uri.joinPath(documentUri, "..");
  return {
    ...update,
    baseUri: `${webview.asWebviewUri(directoryUri)}/`,
  };
}
