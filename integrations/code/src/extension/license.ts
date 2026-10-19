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
import type { ExtensionContext, SecretStorage } from "vscode";

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/** License credential, separate from runtime access tokens and settings. */
const key = "zensical.studio.license";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Register license entry independently of Studio availability.
 *
 * @param extension - Extension context
 * @param refreshAccess - Refresh access after a license change
 */
export function registerLicense(
  extension: ExtensionContext,
  refreshAccess?: () => Promise<void>,
): void {
  extension.subscriptions.push(
    vscode.commands.registerCommand(
      "zensicalStudio.enterLicenseKey",
      () => enterLicenseKey(extension.secrets),
    ),
  );
  if (refreshAccess !== undefined) {
    extension.subscriptions.push(
      extension.secrets.onDidChange(event => {
        if (event.key === key) {
          void refreshAccess().catch(() => {
            void vscode.window.showWarningMessage(
              "Studio access could not be refreshed. " +
              "Use Zensical Studio: Restart Server to try again.",
            );
          });
        }
      }),
    );
  }
}

/**
 * Read the saved license credential for release resolution.
 *
 * @param secrets - Extension secret storage
 *
 * @returns Saved license key, or nothing if none is set
 */
export function readLicenseKey(
  secrets: SecretStorage,
): Thenable<string | undefined> {
  return secrets.get(key);
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Update the saved license credential.
 *
 * @param secrets - Extension secret storage
 */
async function enterLicenseKey(secrets: SecretStorage): Promise<void> {
  let value: string | undefined;
  try {
    value = await vscode.window.showInputBox({
      title: "Zensical Studio: Enter License Key",
      prompt: "Enter your Studio license key. " +
        "Leave empty to remove the saved key.",
      password: true,
      ignoreFocusOut: true,
    });
    if (value === undefined) {
      return;
    }
    value = value.trim();
    if (value.length > 0) {
      await secrets.store(key, value);
    } else {
      await secrets.delete(key);
    }
  } catch {
    void vscode.window.showErrorMessage(
      "Could not update the license key. Please try again.",
    );
    return;
  }
  void vscode.window.showInformationMessage(
    value.length > 0
      ? "License key saved securely."
      : "License key removed.",
  );
}
