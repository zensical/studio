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
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { basename, dirname, join, relative, sep, isAbsolute } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { ExtensionContext } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import { isSameUri } from "./extension/project-path";
import { decodePreviewMessage } from "./preview-messages";
import type { PreviewActionContext } from "./preview-messages";

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
  words: number;
  cjkUnits: number;
  readingSeconds: number;
  resources?: Array<{ logicalUri: string; physicalUri: string }>;
  resourceBase?: string | null;
  resourceRevision?: number;
  externalResources?: string[];
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
  webviewCsp: string;
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

/**
 * Variants available for a preview document.
 */
interface PreviewVariants {
  defaultVariant?: string;
  variants: string[];
}

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

// LSP notification for preview updates.
const previewStart = "zensical/preview/start";
const previewStop = "zensical/preview/stop";
const previewUpdate = "zensical/preview/update";
const previewVariants = "zensical/preview/variants";
const previewVariantsChanged = "zensical/preview/variantsChanged";

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
 * Active preview context used by editor-side document statistics.
 */
let activePreviewContext:
  { uri: string; variant?: string; projections: Record<string, string> }
  | undefined;

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
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
        },
      );

      // Keep the page empty until Studio supplies its security policy.
      activePanel = panel;
      let installedWebviewCsp: string | undefined;

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
      let selectedVariant: string | undefined;
      let availableVariants: string[] = [];
      let variantUpdateGeneration = 0;
      let actionContext: PreviewActionContext | undefined;

      const isCurrentAction = (candidate: PreviewActionContext): boolean =>
        !disposed && !!actionContext && candidate.session === activeSession &&
        candidate.uri === activeUri && candidate.session === actionContext.session &&
        candidate.uri === actionContext.uri && candidate.generation === actionContext.generation;

      const publishUpdate = (update: PreviewUpdate, uri: string): void => {
        if (disposed || uri !== activeUri || update.session !== activeSession ||
            !isSameDocumentUri(update.uri, uri) || !Number.isSafeInteger(update.version) ||
            update.version < latestVersion) return;
        const document = vscode.workspace.textDocuments.find(document =>
          isSameDocumentUri(document.uri.toString(), uri));
        if (document && update.version < document.version) return;
        actionContext = { session: update.session, uri, generation: randomUUID() };
        void panel.webview.postMessage({
          type: "preview/update",
          update: {
            ...withPreviewBase(panel.webview, update, uri, context.extensionUri),
            context: actionContext,
          },
        });
      };

      const sourceChanges = vscode.workspace.onDidChangeTextDocument(event => {
        if (activeUri && isSameDocumentUri(event.document.uri.toString(), activeUri)) {
          actionContext = undefined;
        }
      });
      context.subscriptions.push(sourceChanges);

      // Generate a unique key for storing the selected variant
      const variantStateKey = (uri: string) => `preview.variant.${uri}`;

      // Post the available variants and selected variant to the webview
      const postVariants = () => {
        void panel.webview.postMessage({
          type: "preview/variants",
          variants: availableVariants,
          selectedVariant,
        });
      };

      // Query the available variants for a document from the language server
      const queryVariants = async (
        document: vscode.TextDocument,
      ): Promise<PreviewVariants | undefined> => {
        try {
          return await client.sendRequest<PreviewVariants>(
            previewVariants,
            { uri: document.uri.toString() },
          );
        } catch {
          // Older servers and projects without a catalog have no variants.
          return undefined;
        }
      };

      // Set the available variants and selected variant for a document
      const setVariants = async (
        document: vscode.TextDocument,
        updateSession: boolean,
      ): Promise<void> => {
        const uri = document.uri.toString();
        const generation = ++variantUpdateGeneration;
        const result = await queryVariants(document);
        if (disposed || generation !== variantUpdateGeneration || uri !== activeUri) {
          return;
        }

        // Update the selected variant and persist it in the workspace state
        const previous = selectedVariant;
        availableVariants = result?.variants ?? [];
        const persisted = context.workspaceState.get<string>(
          variantStateKey(uri),
        );
        selectedVariant = availableVariants.includes(persisted ?? "")
          ? persisted
          : result?.defaultVariant;
        activePreviewContext = {
          uri,
          variant: selectedVariant,
          projections: {},
        };
        if (selectedVariant && availableVariants.includes(selectedVariant)) {
          void context.workspaceState.update(
            variantStateKey(uri), selectedVariant,
          );
        }
        postVariants();

        // If the selected variant has changed, send a preview update
        if (
          updateSession &&
          activeSession &&
          selectedVariant !== previous
        ) {
          await client.sendRequest<void>(previewUpdate, {
            session: activeSession,
            variant: selectedVariant,
            projections: {},
          });
        }
      };

      // Accept only updates for the active session, then debounce the web view
      // replacement so rapid editor changes do not trigger a DOM rebuild each
      notificationDisposable = client.onNotification(
        previewUpdate, (update: PreviewUpdate) => {
          // Ignore updates for inactive sessions or older versions
          if (
            update.session !== activeSession ||
            update.version < latestVersion ||
            !activeUri ||
            !isSameDocumentUri(update.uri, activeUri)
          ) {
            return;
          }

          // Debounce updates to avoid excessive DOM rebuilds in the web view
          const uri = activeUri;
          latestVersion = update.version;
          latestUpdate = update;
          if (updateTimer) clearTimeout(updateTimer);
          updateTimer = setTimeout(() => {
            updateTimer = undefined;
            const current = latestUpdate;
            if (!current || current.version < latestVersion) return;
            publishUpdate(current, uri);
          }, 100);
        },
      );

      // Listen for variant changes from the language server and update preview
      const variantsChangedDisposable = client.onNotification(
        previewVariantsChanged,
        async () => {
          if (!activeUri) return;
          try {
            const document = await vscode.workspace.openTextDocument(
              vscode.Uri.parse(activeUri),
            );
            await setVariants(document, true);
          } catch (error) {
            if (!disposed) {
              const detail = error instanceof Error ? error.message : String(error);
              void vscode.window.showErrorMessage(
                `Unable to update Zensical Preview variants: ${detail}`,
              );
            }
          }
        },
      );

      // Dispose of the panel and clean up resources when it is closed
      panel.onDidDispose(() => {
        disposed = true;
        actionContext = undefined;
        sourceChanges.dispose();
        switchGeneration += 1;
        pendingDocument = undefined;
        const session = activeSession;
        activePanel = undefined;
        activeSession = undefined;
        activeUri = undefined;
        activePreviewContext = undefined;
        notificationDisposable?.dispose();
        notificationDisposable = undefined;
        variantsChangedDisposable.dispose();
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
        async (value: unknown) => {
          const message = decodePreviewMessage(value);
          if (!message) return;
          if (message.type === "preview/ready") {
            // A fast native response may precede the webview's listener.
            // Replay the retained current render after the page is ready.
            if (!disposed && activeUri && latestUpdate &&
                latestUpdate.session === activeSession) {
              publishUpdate(latestUpdate, activeUri);
              postVariants();
              postEditorPosition(vscode.window.activeTextEditor, true);
            }
            return;
          }
          if (!isCurrentAction(message.context)) return;
          if (message.type === "preview/reveal-source") {
            const uri = activeUri;
            if (
              !message.uri ||
              !uri ||
              !isSameDocumentUri(message.uri, uri)
            ) {
              return;
            }
            const known = vscode.workspace.textDocuments.find(document =>
              isSameDocumentUri(document.uri.toString(), uri));
            if (!known || message.end > Buffer.byteLength(known.getText(), "utf8")) return;
            try {
              const document = await vscode.workspace.openTextDocument(
                vscode.Uri.parse(uri),
              );
              if (!isCurrentAction(message.context) ||
                  message.end > Buffer.byteLength(document.getText(), "utf8")) return;
              const editor = await vscode.window.showTextDocument(document, {
                preview: true,
                preserveFocus: false,
                viewColumn:
                  vscode.window.activeTextEditor?.viewColumn ??
                  vscode.ViewColumn.One,
              });
              if (!isCurrentAction(message.context)) return;
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
          if (message.type === "preview/select-variant") {
            if (
              !activeUri ||
              !activeSession ||
              !message.variant ||
              !availableVariants.includes(message.variant) ||
              message.variant === selectedVariant
            ) {
              return;
            }
            const session = activeSession;
            const uri = activeUri;
            selectedVariant = message.variant;
            activePreviewContext = {
              uri,
              variant: selectedVariant,
              projections: {},
            };
            void context.workspaceState.update(
              variantStateKey(uri), selectedVariant,
            );
            postVariants();
            try {
              await client.sendRequest<void>(previewUpdate, {
                session,
                variant: selectedVariant,
                projections: {},
              });
            } catch (error) {
              if (session === activeSession && uri === activeUri) {
                const detail = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(
                  `Unable to update Zensical Preview: ${detail}`,
                );
              }
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
            const target = resolveLocalFile(link.uri);
            if (!target) return;
            if (!isWorkspaceUri(target)) {
              const choice = await vscode.window.showWarningMessage(
                "Open this file outside the workspace?",
                { modal: true, detail: `${target.fsPath}\nOnly this file will open. Its folder will not gain workspace access.` },
                "Open File",
              );
              if (choice !== "Open File" || !isCurrentAction(message.context)) return;
            }
            const current = resolveLocalFile(target);
            if (!current || !isSameUri(target, current) || !isCurrentAction(message.context)) return;
            const document = await vscode.workspace.openTextDocument(target);
            if (!isCurrentAction(message.context)) return;
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
                uri: target.toString(),
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
            actionContext = undefined;
            const previousSession = activeSession;
            activeSession = undefined;
            activeUri = undefined;
            variantUpdateGeneration += 1;
            availableVariants = [];
            selectedVariant = undefined;
            activePreviewContext = undefined;
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
              const variants = await queryVariants(document);
              const persisted = context.workspaceState.get<string>(
                variantStateKey(uri),
              );
              availableVariants = variants?.variants ?? [];
              selectedVariant = availableVariants.includes(persisted ?? "")
                ? persisted
                : variants?.defaultVariant;
              activePreviewContext = {
                uri,
                variant: selectedVariant,
                projections: {},
              };
              if (selectedVariant && availableVariants.includes(selectedVariant)) {
                void context.workspaceState.update(
                  variantStateKey(uri), selectedVariant,
                );
              }
              result = await client.sendRequest<PreviewStartResult>(
                previewStart,
                {
                  uri,
                  projections: {},
                  ...(selectedVariant ? { variant: selectedVariant } : {}),
                },
              );
              if (typeof result.webviewCsp !== "string" || !result.webviewCsp.trim()) {
                void client.sendNotification(previewStop, { session: result.session });
                if (!disposed && generation === switchGeneration) {
                  activePreviewContext = undefined;
                  panel.webview.html = "";
                  installedWebviewCsp = undefined;
                }
                throw new Error("Studio did not provide a preview security policy. Update the Studio runtime.");
              }
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

            // Install native policy before any document content reaches the page.
            if (installedWebviewCsp !== result.webviewCsp) {
              panel.webview.html = previewHtml(
                panel.webview, context.extensionUri, result.webviewCsp,
              );
              installedWebviewCsp = result.webviewCsp;
            }

            // Update the active session and send the initial preview update
            activeSession = result.session;
            activeUri = uri;
            activePreviewContext = {
              uri,
              variant: selectedVariant,
              projections: {},
            };
            startingUri = undefined;
            latestVersion = result.initialUpdate.version;
            latestUpdate = result.initialUpdate;
            publishUpdate(result.initialUpdate, uri);
            postVariants();
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

/**
 * Returns the selected context for an active preview document.
 *
 * @param uri - The URI of the document
 *
 * @returns Active preview context, or undefined if not active
 */
export function getActivePreviewContext(
  uri: string,
): { variant?: string; projections: Record<string, string> } | undefined {
  if (activePreviewContext?.uri !== uri) return undefined;
  return activePreviewContext;
}

/* ------------------------------------------------------------------------- */

/**
 * Generate the HTML content for the preview webview.
 *
 * @param webview - The webview instance
 * @param extensionUri - The URI of the extension
 * @param contentSecurityPolicy - Complete native policy with host placeholders
 *
 * @returns The HTML content as a string
 */
function previewHtml(
  webview: vscode.Webview, extensionUri: vscode.Uri,
  contentSecurityPolicy: string,
): string {
  const nonce = randomBytes(24).toString("base64");
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
  const mermaid = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "mermaid.js"),
  );
  const csp = contentSecurityPolicy
    .replaceAll("__CSP_SOURCE__", webview.cspSource)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
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
    .replaceAll("__KATEX_STYLESHEET__", katexStylesheet.toString())
    .replaceAll("__MERMAID__", mermaid.toString());
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
 * @param activeUri - The active document URI from VS Code
 *
 * @returns The augmented preview update with a base URI
 */
function withPreviewBase(
  webview: vscode.Webview, update: PreviewUpdate, activeUri: string,
  extensionUri: vscode.Uri,
): PreviewUpdate & {
  baseUri: string;
  resourceMap: Record<string, string>;
  externalResources: string[];
  siteRoot?: string;
} {
  const uri = isSameDocumentUri(update.uri, activeUri)
    ? activeUri
    : update.uri;
  const documentUri = vscode.Uri.parse(uri);
  const directoryUri = vscode.Uri.joinPath(documentUri, "..");
  const resources = (update.resources ?? []).map(resource => ({
    logical: vscode.Uri.parse(resource.logicalUri),
    physical: vscode.Uri.parse(resource.physicalUri),
  }));
  webview.options = {
    ...webview.options,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, "media"),
    ],
  };
  const resourceMap = Object.fromEntries(resources.map(
    ({ logical, physical }) => [
      webview.asWebviewUri(logical).toString(),
      webview.asWebviewUri(physical).toString(),
    ],
  ));
  const siteRoot = update.resourceBase
    ? webview.asWebviewUri(vscode.Uri.parse(update.resourceBase)).toString()
    : undefined;
  return {
    ...update,
    uri,
    mappings: canonicalizeMappingUris(update.mappings, uri),
    baseUri: `${webview.asWebviewUri(directoryUri)}/`,
    resourceMap,
    externalResources: update.externalResources ?? [],
    siteRoot: siteRoot ? `${siteRoot.replace(/\/+$/, "")}/` : undefined,
  };
}

/**
 * Canonicalize mapping URIs that identify the rendered document.
 *
 * @param mappings - Preview source mappings
 * @param documentUri - Canonical URI of the rendered document
 *
 * @returns Source mappings with canonical document URIs
 */
function canonicalizeMappingUris(
  mappings: MappingSegment[], documentUri: string,
): MappingSegment[] {
  const uris = new Map<string, string>();
  const canonicalizeSpan = (span: Span): Span => {
    let uri = uris.get(span.uri);
    if (typeof uri === "undefined") {
      uri = isSameDocumentUri(span.uri, documentUri)
        ? documentUri
        : span.uri;
      uris.set(span.uri, uri);
    }
    return uri === span.uri ? span : { ...span, uri };
  };

  return mappings.map((mapping) => {
    const markdown = mapping.markdown;
    if (markdown.type === "direct") {
      const spans = canonicalizeSpan(markdown.spans);
      if (spans === markdown.spans) return mapping;
      return {
        ...mapping,
        markdown: { ...markdown, spans },
      };
    }

    const spans = markdown.spans.map(canonicalizeSpan);
    if (spans.every((span, index) => span === markdown.spans[index])) {
      return mapping;
    }
    return {
      ...mapping,
      markdown: { ...markdown, spans },
    };
  });
}

/**
 * Check whether two serialized URIs identify the same document.
 *
 * Parsing first makes equivalent percent-encoded paths comparable. File paths
 * are additionally compared case-insensitively on Windows.
 *
 * @param uri - First serialized URI
 * @param other - Second serialized URI
 *
 * @returns Whether the URIs identify the same document
 */
function isSameDocumentUri(uri: string, other: string): boolean {
  if (uri === other) return true;
  try {
    return isSameUri(vscode.Uri.parse(uri), vscode.Uri.parse(other));
  } catch {
    return false;
  }
}

/** Resolve one explicit editor-navigation target; never grants resource access. */
function resolveLocalFile(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== "file") return undefined;
  try {
    return vscode.Uri.file(realpathSync.native(uri.fsPath));
  } catch {
    try {
      try {
        lstatSync(uri.fsPath);
        return undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      }
      return vscode.Uri.file(join(
        realpathSync.native(dirname(uri.fsPath)), basename(uri.fsPath),
      ));
    } catch {
      return undefined;
    }
  }
}

function isWorkspaceUri(uri: vscode.Uri): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(({ uri: root }) => {
    if (root.scheme !== "file") return false;
    try {
      const difference = relative(realpathSync.native(root.fsPath), uri.fsPath);
      return difference === "" || (
        difference !== ".." &&
        !difference.startsWith(`..${sep}`) &&
        !isAbsolute(difference)
      );
    } catch {
      return false;
    }
  });
}
