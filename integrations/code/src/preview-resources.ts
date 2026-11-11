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
import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** Read-only delivery of local files to one preview panel. */
export class PreviewResources implements vscode.FileSystemProvider, vscode.Disposable {
  static readonly scheme = "zensical-preview-resource";
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  private readonly roots = new Map<string, string>();
  private readonly external = new Map<string, Stats>();
  private prefix = "";
  private sourceUri: string | undefined;
  private owner: string | undefined;

  /** Refresh exact native file grants for the displayed document. */
  update(document: vscode.Uri, resources: Array<{ logicalUri: string; physicalUri: string }> = []): Array<{
    logical: vscode.Uri; physical: vscode.Uri;
  }> {
    if (!this.prefix || this.sourceUri !== document.toString()) {
      this.prefix = `/${randomUUID()}/`;
    }
    this.sourceUri = document.toString();
    this.external.clear();
    this.owner = undefined;
    this.workspaceRoots();
    try {
      let source: string;
      try {
        source = realpathSync.native(document.fsPath);
      } catch {
        // New editor buffers may have no saved leaf. Resolve their existing
        // parent, but never treat a dangling symlink as an unsaved document.
        try { lstatSync(document.fsPath); throw this.denied(); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        source = join(realpathSync.native(dirname(document.fsPath)), basename(document.fsPath));
      }
      this.owner = [...this.roots].find(([, root]) => this.inside(source, root))?.[0];
    } catch { /* An unresolved source cannot authorize external resources. */ }
    const accepted: Array<{ logical: vscode.Uri; physical: vscode.Uri }> = [];
    if (!Array.isArray(resources)) return accepted;
    for (const resource of resources.slice(0, 4096)) {
      try {
        const logical = this.fileUri(resource.logicalUri);
        const declared = this.fileUri(resource.physicalUri);
        const physical = vscode.Uri.file(realpathSync.native(declared.fsPath));
        const metadata = statSync(physical.fsPath);
        if (!metadata.isFile()) continue;
        // The native app owns configured external reads. Its declarations are
        // exact, resolved files; a symlink spelling cannot grant outside bytes.
        if (!this.inWorkspace(physical.fsPath)) {
          if (!this.owner || !this.samePath(declared.fsPath, physical.fsPath)) continue;
          this.external.set(physical.fsPath, metadata);
        }
        accepted.push({ logical, physical });
      } catch {
        // Invalid, missing and unresolved declarations grant no access.
      }
    }
    return accepted;
  }

  /** A virtual root grants no direct file: access to the webview loader. */
  get root(): vscode.Uri {
    return vscode.Uri.from({ scheme: PreviewResources.scheme, path: this.prefix });
  }

  get externalPaths(): string[] { return [...this.external.keys()]; }

  /** Mirror file paths so ordinary relative and site-root URLs still resolve. */
  uri(file: vscode.Uri): vscode.Uri {
    if (file.scheme !== "file" || !this.prefix) throw this.denied();
    const authority = Buffer.from(file.authority).toString("base64url") || "-";
    return vscode.Uri.from({
      scheme: PreviewResources.scheme,
      path: `${this.prefix}${authority}${file.path}`,
      query: file.query, fragment: file.fragment,
    });
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    return this.withFile(uri, (_descriptor, metadata) => ({
      type: vscode.FileType.File, ctime: metadata.ctimeMs,
      mtime: metadata.mtimeMs, size: metadata.size,
      permissions: vscode.FilePermission.Readonly,
    }));
  }

  readFile(uri: vscode.Uri): Uint8Array {
    return this.withFile(uri, (descriptor, metadata) => {
      // Read at most the checked size plus one byte, even if a file grows.
      if (metadata.size > 32 * 1024 * 1024) {
        throw vscode.FileSystemError.Unavailable("Preview resource exceeds 32 MiB");
      }
      const bytes = Buffer.alloc(metadata.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(descriptor, bytes, length, bytes.length - length, length);
        if (count === 0) break;
        length += count;
      }
      if (length !== metadata.size || fstatSync(descriptor).mtimeMs !== metadata.mtimeMs) {
        throw vscode.FileSystemError.Unavailable("Preview resource changed while reading");
      }
      return bytes.subarray(0, length);
    });
  }

  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  readDirectory(): never { throw this.denied(); }
  createDirectory(): never { throw this.denied(); }
  writeFile(): never { throw this.denied(); }
  delete(): never { throw this.denied(); }
  rename(): never { throw this.denied(); }

  clear(): void { this.prefix = ""; this.sourceUri = undefined; this.owner = undefined; this.external.clear(); }
  dispose(): void { this.clear(); this.roots.clear(); this.changes.dispose(); }

  private withFile<T>(uri: vscode.Uri, use: (descriptor: number, metadata: Stats) => T): T {
    if (uri.scheme !== PreviewResources.scheme || !this.prefix ||
        uri.authority || !uri.path.startsWith(this.prefix)) throw this.denied();
    this.workspaceRoots();
    if (this.owner && !this.roots.has(this.owner)) throw this.denied();
    const suffix = uri.path.slice(this.prefix.length);
    const slash = suffix.indexOf("/");
    if (slash < 1) throw this.denied();
    const encoded = suffix.slice(0, slash);
    if (encoded !== "-" && !/^[A-Za-z0-9_-]+$/.test(encoded)) throw this.denied();
    const authority = encoded === "-" ? "" : Buffer.from(encoded, "base64url").toString();
    const target = vscode.Uri.from({ scheme: "file", authority, path: suffix.slice(slash) });
    let descriptor: number | undefined;
    try {
      const physical = realpathSync.native(target.fsPath);
      const metadata = statSync(physical);
      const external = this.external.get(physical);
      if (!metadata.isFile() || (!this.inWorkspace(physical) &&
          (!external || !this.sameFile(external, metadata)))) throw this.denied();
      descriptor = openSync(physical, "r");
      const opened = fstatSync(descriptor);
      if (!this.sameFile(metadata, opened) || !opened.isFile() ||
          !this.samePath(realpathSync.native(target.fsPath), physical)) throw this.denied();
      return use(descriptor, opened);
    } catch (error) {
      if (error instanceof vscode.FileSystemError) throw error;
      throw vscode.FileSystemError.FileNotFound("Preview resource is missing or unresolved");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  private fileUri(value: string): vscode.Uri {
    if (typeof value !== "string" || value.length > 64 * 1024) throw this.denied();
    const uri = vscode.Uri.parse(value, true);
    if (uri.scheme !== "file" || uri.query || uri.fragment) throw this.denied();
    return uri;
  }

  private workspaceRoots(): string[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const present = new Set(folders.map(folder => folder.uri.toString()));
    for (const key of this.roots.keys()) if (!present.has(key)) this.roots.delete(key);
    for (const { uri } of folders) {
      if (uri.scheme !== "file" || this.roots.has(uri.toString())) continue;
      try { this.roots.set(uri.toString(), realpathSync.native(uri.fsPath)); }
      catch { /* Unresolved folders grant no access. */ }
    }
    return [...this.roots.values()];
  }

  private inWorkspace(file: string): boolean {
    return this.workspaceRoots().some(root => this.inside(file, root));
  }

  private inside(file: string, root: string): boolean {
    const difference = relative(root, file);
    return difference === "" || (difference !== ".." &&
      !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
  }

  private samePath(left: string, right: string): boolean {
    return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  }

  private sameFile(left: Stats, right: Stats): boolean {
    return left.dev === right.dev && left.ino === right.ino;
  }

  private denied(): vscode.FileSystemError {
    return vscode.FileSystemError.NoPermissions("Preview resource is outside the permitted read scope");
  }
}
