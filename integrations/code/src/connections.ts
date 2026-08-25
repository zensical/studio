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
import type { ExtensionContext } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { Range } from "vscode-languageserver-types";

import {
  getVisibleSections,
  type AssetKindCount,
  type ConnectionsSummary,
  type NavigationContext,
  type NavigationEntry,
  type RelationshipEntries,
  type RelationshipEntry,
  type RelationshipGroupKind,
  type RelationshipOccurrence,
  type RelationshipSubject,
  type VisibleRelationshipGroup,
  type VisibleRelationshipSection,
} from "./connections/model";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Tree node for a relationship view.
 */
type RelationshipNode =
  | NavigationSectionNode
  | NavigationAncestorNode
  | NavigationEntryNode
  | NavigationNeighborNode
  | SectionNode
  | GroupNode
  | EntryNode
  | OccurrenceNode
  | ShowMoreNode;

/**
 * Tree node for a relationship section.
 */
interface SectionNode {
  type: "section";
  section: VisibleRelationshipSection;
}

/**
 * Root section for authored page placement in project navigation.
 */
interface NavigationSectionNode {
  type: "navigation";
  contexts: NavigationContext[];
}

/**
 * One label-only level in the authored navigation hierarchy.
 */
interface NavigationAncestorNode {
  type: "navigationAncestor";
  contexts: NavigationContext[];
  ancestors: string[];
}

/**
 * The active page as it is named in one navigation occurrence.
 */
interface NavigationEntryNode {
  type: "navigationEntry";
  context: NavigationContext;
  index: number;
}

/**
 * A neighboring page in the active navigation branch.
 */
interface NavigationNeighborNode {
  type: "navigationNeighbor";
  relation: "Previous" | "Next";
  entry: NavigationEntry;
  index: number;
}

/**
 * Tree node for a relationship group.
 */
interface GroupNode {
  type: "group";
  group: RelationshipGroupState;
}

/**
 * Tree node for a relationship entry.
 */
interface EntryNode {
  type: "entry";
  group: RelationshipGroupState;
  entry: RelationshipEntry;
  index: number;
}

/**
 * Tree node for a relationship occurrence.
 */
interface OccurrenceNode {
  type: "occurrence";
  occurrence: RelationshipOccurrence;
  index: number;
}

/**
 * Tree node for a "show more" placeholder.
 */
interface ShowMoreNode {
  type: "showMore";
  group: RelationshipGroupState;
}

/**
 * State for a relationship group, including loaded entries and pagination.
 */
interface RelationshipGroupState extends VisibleRelationshipGroup {
  items: RelationshipEntry[];
  loaded: boolean;
  nextOffset: number | null;
  loading?: Promise<void>;
}

/**
 * State of the relationships view.
 */
type ViewState = "idle" | "loading" | "ready" | "unavailable" | "error";

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

/**  */
const viewId = "zensicalStudio.connections";
const followContext = "zensicalStudio.connections.followActiveEditor";
const pageSize = 100;

/* ----------------------------------------------------------------------------
 * Classes
 * ------------------------------------------------------------------------- */

/** Sticky, lazily loaded document relationships tree. */
export class ConnectionsView
implements vscode.TreeDataProvider<RelationshipNode>, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<RelationshipNode | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly tree: vscode.TreeView<RelationshipNode>;
  private readonly groups = new Map<RelationshipGroupKind, RelationshipGroupState>();
  private readonly expandedGroups = new Set<RelationshipGroupKind>();
  private clientDisposables: vscode.Disposable[] = [];
  private notificationTimer: ReturnType<typeof setTimeout> | undefined;
  private state: ViewState = "idle";
  private resource: vscode.Uri | undefined;
  private summary: ConnectionsSummary | undefined;
  private generation = 0;
  private following = true;

  readonly onDidChangeTreeData = this.changes.event;

  /** Create and register the relationships view and its commands. */
  constructor(
    context: ExtensionContext,
    private readonly getClient: () => LanguageClient | undefined,
  ) {
    this.tree = vscode.window.createTreeView(viewId, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    void vscode.commands.executeCommand("setContext", followContext, true);
    const active = getActiveResource();
    if (active) {
      this.resource = active;
    }

    // Register commands and listeners for the view
    this.disposables.push(
      this.tree,
      this.changes,
      vscode.commands.registerCommand(
        "zensicalStudio.connections.show",
        async (resource?: vscode.Uri) => {
          const uri = resource instanceof vscode.Uri ? resource : getActiveResource();
          if (!uri) return;
          await this.setResource(uri);
          await vscode.commands.executeCommand(`${viewId}.focus`);
        },
      ),
      vscode.commands.registerCommand(
        "zensicalStudio.connections.refresh",
        () => this.refresh(),
      ),
      vscode.commands.registerCommand(
        "zensicalStudio.connections.follow",
        async () => {
          await this.setFollowing(true);
          const uri = getActiveResource();
          if (uri) await this.setResource(uri);
        },
      ),
      vscode.commands.registerCommand(
        "zensicalStudio.connections.pin",
        () => this.setFollowing(false),
      ),
      vscode.commands.registerCommand(
        "zensicalStudio.connections.open",
        (uri: string, range?: Range) => openLocation(uri, range),
      ),
      vscode.commands.registerCommand(
        "zensicalStudio.connections.more",
        (group: RelationshipGroupState) => this.loadMore(group),
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.following && editor) void this.setResource(editor.document.uri);
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        if (!this.following || !event.changed.some((tab) => tab.isActive)) return;
        const uri = getActiveResource();
        if (uri) void this.setResource(uri);
      }),
      this.tree.onDidExpandElement(({ element }) => {
        if (element.type === "group") this.expandedGroups.add(element.group.kind);
      }),
      this.tree.onDidCollapseElement(({ element }) => {
        if (element.type === "group") this.expandedGroups.delete(element.group.kind);
      }),
      this.tree.onDidChangeVisibility(({ visible }) => {
        if (visible && this.resource && this.state === "idle") {
          void this.refresh();
        }
      }),
    );
    context.subscriptions.push(this);
  }

  /** Attach refresh notifications to the current language client. */
  attachClient(client: LanguageClient): void {
    for (const disposable of this.clientDisposables) disposable.dispose();
    this.clientDisposables = [
      client.onNotification("zensical/document/connectionsChanged", () => {
        this.scheduleNotificationRefresh();
      }),
    ];
    if (this.tree.visible) void this.refresh();
  }

  /** Dispose commands, listeners, and the tree view. */
  dispose(): void {
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    for (const disposable of this.clientDisposables) disposable.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.clientDisposables = [];
    this.disposables.length = 0;
  }

  /** Return a rendered tree item. */
  getTreeItem(node: RelationshipNode): vscode.TreeItem {
    switch (node.type) {
      case "navigation":
        return navigationSectionTreeItem(node);
      case "navigationAncestor":
        return navigationAncestorTreeItem(node);
      case "navigationEntry":
        return navigationEntryTreeItem(node);
      case "navigationNeighbor":
        return navigationNeighborTreeItem(node);
      case "section":
        return sectionTreeItem(node);
      case "group":
        return groupTreeItem(node);
      case "entry":
        return entryTreeItem(node);
      case "occurrence":
        return occurrenceTreeItem(node);
      case "showMore":
        return showMoreTreeItem(node);
    }
  }

  /** Return tree children, loading relationship groups only when expanded. */
  async getChildren(node?: RelationshipNode): Promise<RelationshipNode[]> {
    if (!node) {
      if (this.state !== "ready" || !this.summary) return [];
      const navigation = this.summary.navigation || [];
      return [
        ...getVisibleSections(this.summary.groups).map(
          (section): SectionNode => ({ type: "section", section }),
        ),
        ...(navigation.length
          ? [{ type: "navigation", contexts: navigation } satisfies NavigationSectionNode]
          : []),
      ];
    }

    // Return children for the given node type
    switch (node.type) {
      case "navigation":
        return navigationChildren(node.contexts, []);
      case "navigationAncestor":
        return navigationChildren(node.contexts, node.ancestors);
      case "navigationEntry":
        return [
          ...(node.context.previous
            ? [{
              type: "navigationNeighbor",
              relation: "Previous",
              entry: node.context.previous,
              index: node.index,
            } satisfies NavigationNeighborNode]
            : []),
          ...(node.context.next
            ? [{
              type: "navigationNeighbor",
              relation: "Next",
              entry: node.context.next,
              index: node.index,
            } satisfies NavigationNeighborNode]
            : []),
        ];
      case "navigationNeighbor":
        return [];
      case "section":
        return (await Promise.all(node.section.groups.map(async (definition) => {
          const group = this.groups.get(definition.kind)!;
          if (!group.flat)
            return [{ type: "group", group } satisfies GroupNode];
          await this.loadInitial(group);
          return groupChildren(group);
        }))).flat();
      case "group":
        await this.loadInitial(node.group);
        return groupChildren(node.group);
      case "entry":
        return node.entry.occurrences.map((occurrence, index): OccurrenceNode => ({
          type: "occurrence", occurrence, index,
        }));
      case "showMore":
        await this.loadMore(node.group);
        return [];
      case "occurrence":
        return [];
    }
  }

  /** Refresh the current subject without changing its pinned URI. */
  async refresh(): Promise<void> {
    if (!this.resource) return;
    const expanded = [...this.expandedGroups];
    await this.loadSummary(this.resource);
    if (this.state === "ready") await this.reloadExpandedGroups(expanded);
  }

  /** Select a new subject resource. */
  private async setResource(resource: vscode.Uri): Promise<void> {
    const changed = this.resource?.toString() !== resource.toString();
    if (!changed && this.state === "ready") {
      return;
    }
    this.resource = resource;
    if (!this.tree.visible) {
      this.generation++;
      this.state = "idle";
      this.summary = undefined;
      this.groups.clear();
      this.tree.description = undefined;
      this.tree.message = undefined;
      this.changes.fire(undefined);
      return;
    }
    await this.loadSummary(resource);
  }

  /** Request and render the relationship summary. */
  private async loadSummary(resource: vscode.Uri): Promise<void> {
    const generation = ++this.generation;
    this.state = "loading";
    this.summary = undefined;
    this.groups.clear();
    this.tree.description = undefined;
    this.tree.message = undefined;
    this.changes.fire(undefined);

    // Request the summary from the language client
    const client = this.getClient();
    if (!client) {
      this.state = "idle";
      this.tree.message = "Initializing...";
      this.changes.fire(undefined);
      return;
    }
    try {
      const summary = await client.sendRequest<ConnectionsSummary | null>(
        "zensical/document/connections",
        { uri: resource.toString() },
      );
      if (generation !== this.generation) return;
      if (summary === null) {
        this.state = "unavailable";
        this.tree.message =
          "This resource is outside the indexed Zensical Studio workspace.";
        this.changes.fire(undefined);
        return;
      }

      // Render the summary and initialize group states
      this.state = "ready";
      this.summary = summary;
      this.tree.description = summary.subject.name;
      const sections = getVisibleSections(summary.groups);
      for (const group of sections.flatMap((section) => section.groups)) {
        this.groups.set(group.kind, {
          ...group,
          items: [],
          loaded: false,
          nextOffset: null,
        });
      }
      this.tree.message = undefined;
      this.changes.fire(undefined);
    } catch {
      if (generation !== this.generation) return;
      this.state = "error";
      this.tree.message = "Document relationships are currently unavailable.";
      this.changes.fire(undefined);
    }
  }

  /** Load the first page of a group. */
  private async loadInitial(group: RelationshipGroupState): Promise<void> {
    if (!group.loaded) await this.loadPage(group, 0);
  }

  /** Load the next page of a group. */
  private async loadMore(group: RelationshipGroupState): Promise<void> {
    if (!group.loaded) {
      await this.loadPage(group, 0);
    } else if (group.nextOffset !== null) {
      await this.loadPage(group, group.nextOffset);
    }
    this.changes.fire(undefined);
  }

  /** Request one relationship group page. */
  private async loadPage(
    group: RelationshipGroupState,
    offset: number,
  ): Promise<void> {
    if (group.loading) return group.loading;
    if (this.groups.get(group.kind) !== group) return;
    const resource = this.resource;
    const client = this.getClient();
    if (!resource || !client) return;
    const generation = this.generation;

    // Load the page and update the group state
    group.loading = (async () => {
      try {
        const page = await client.sendRequest<RelationshipEntries>(
          "zensical/document/connectionEntries",
          {
            uri: resource.toString(),
            group: group.kind,
            offset,
            limit: pageSize,
          },
        );
        if (generation !== this.generation) return;
        group.items.push(...page.items);
        group.nextOffset = page.nextOffset;
        group.loaded = true;
      } finally {
        group.loading = undefined;
      }
    })();
    await group.loading;
  }

  /** Reload only relationship groups that are currently expanded. */
  private async reloadExpandedGroups(
    kinds: RelationshipGroupKind[],
  ): Promise<void> {
    await Promise.allSettled(
      kinds.map(async (kind) => {
        const group = this.groups.get(kind);
        if (group) await this.loadInitial(group);
      }),
    );
    this.changes.fire(undefined);
  }

  /** Debounce broad workspace connection updates while the view is visible. */
  private scheduleNotificationRefresh(): void {
    if (!this.tree.visible) {
      this.generation++;
      this.state = "idle";
      return;
    }
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.notificationTimer = setTimeout(() => {
      this.notificationTimer = undefined;
      void this.refresh();
    }, 150);
  }

  /** Change whether the view follows active editor changes. */
  private async setFollowing(value: boolean): Promise<void> {
    this.following = value;
    await vscode.commands.executeCommand("setContext", followContext, value);
  }
}

/* ----------------------------------------------------------------------------
 * Helper functions
 * ------------------------------------------------------------------------- */

/**
 * Return the next visible level of authored navigation context.
 *
 * @param contexts - Page occurrences represented below this tree level
 * @param ancestors - Authored labels leading to this level
 *
 * @returns Navigation groups and page occurrences in authored order
 */
function navigationChildren(
  contexts: NavigationContext[],
  ancestors: string[],
): RelationshipNode[] {
  const matching = contexts.filter((context) =>
    ancestors.every((label, index) => context.ancestors[index] === label)
  );
  const groups = new Map<string, NavigationContext[]>();
  const entries: NavigationEntryNode[] = [];

  for (const context of matching) {
    const label = context.ancestors[ancestors.length];
    if (label) {
      const group = groups.get(label) || [];
      group.push(context);
      groups.set(label, group);
    } else {
      entries.push({
        type: "navigationEntry",
        context,
        index: entries.length,
      });
    }
  }

  return [
    ...[...groups.entries()].map(([label, contexts]) => ({
      type: "navigationAncestor",
      contexts,
      ancestors: [...ancestors, label],
    }) satisfies NavigationAncestorNode),
    ...entries,
  ];
}

/**
 * Render the root navigation section.
 *
 * @param node - Navigation section node
 *
 * @returns Navigation tree item
 */
function navigationSectionTreeItem(
  node: NavigationSectionNode,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "Navigation",
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.id = "section:navigation";
  item.description = formatEntries(node.contexts.length);
  item.iconPath = new vscode.ThemeIcon("list-tree");
  item.contextValue = "navigationSection";
  item.tooltip = "This page's position in project navigation";
  return item;
}

/**
 * Render an authored navigation group label.
 *
 * @param node - Navigation ancestor node
 *
 * @returns Navigation tree item
 */
function navigationAncestorTreeItem(
  node: NavigationAncestorNode,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.ancestors.at(-1) || "Navigation",
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.id = `navigation:${node.ancestors.join("\u0000")}`;
  item.iconPath = new vscode.ThemeIcon("folder");
  item.contextValue = "navigationAncestor";
  return item;
}

/**
 * Render the active page's authored navigation entry.
 *
 * @param node - Navigation page node
 *
 * @returns Navigation tree item
 */
function navigationEntryTreeItem(node: NavigationEntryNode): vscode.TreeItem {
  const entry = node.context.current;
  const item = new vscode.TreeItem(
    entry.label,
    node.context.previous || node.context.next
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None,
  );
  item.id = navigationEntryId(entry);
  item.description = navigationLocationDescription(entry);
  item.iconPath = new vscode.ThemeIcon("markdown");
  item.contextValue = "navigationCurrent";
  item.tooltip = `${entry.label}\n${item.description}`;
  return item;
}

/**
 * Render one previous or next navigation page.
 *
 * @param node - Navigation neighbor node
 *
 * @returns Navigation tree item
 */
function navigationNeighborTreeItem(
  node: NavigationNeighborNode,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${node.relation}: ${node.entry.label}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `${navigationEntryId(node.entry)}:${node.relation}:${node.index}`;
  item.description = node.entry.path ||
    resourceDescription(vscode.Uri.parse(node.entry.uri));
  item.iconPath = new vscode.ThemeIcon(
    node.relation === "Previous" ? "arrow-small-left" : "arrow-small-right",
  );
  item.contextValue = "navigationNeighbor";
  item.tooltip = `${node.relation}: ${node.entry.label}\n${item.description}`;
  item.command = {
    command: "zensicalStudio.connections.open",
    title: `Open ${node.relation} Navigation Page`,
    arguments: [node.entry.uri],
  };
  return item;
}

/**
 * Return a stable tree ID for an authored navigation entry.
 *
 * @param entry - Navigation entry
 *
 * @returns Stable tree ID string
 */
function navigationEntryId(entry: NavigationEntry): string {
  const range = entry.configurationRange;
  return `navigation:entry:${entry.configurationUri}:` +
    `${range?.start.line ?? 0}:${range?.start.character ?? 0}`;
}

/**
 * Return the configuration location for an authored navigation entry.
 *
 * @param entry - Navigation entry
 *
 * @returns Location description string
 */
function navigationLocationDescription(entry: NavigationEntry): string {
  const uri = vscode.Uri.parse(entry.configurationUri);
  const location = resourceDescription(uri);
  const line = entry.configurationRange
    ? `:${entry.configurationRange.start.line + 1}`
    : "";
  return `${location}${line}`;
}

/**
 * Render a tree item for a relationship section.
 *
 * @param node - Section node
 *
 * @returns Tree item
 */
function sectionTreeItem(node: SectionNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.section.label,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.id = `section:${node.section.label}`;
  item.iconPath = new vscode.ThemeIcon(node.section.icon);
  return item;
}

/**
 * Render a tree item for a relationship group.
 *
 * @param node - Group node
 *
 * @returns Tree item
 */
function groupTreeItem(node: GroupNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.group.label,
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = `group:${node.group.kind}`;
  item.description = groupDescription(node.group);
  item.iconPath = new vscode.ThemeIcon(node.group.icon);
  item.contextValue = "connectionGroup";
  item.tooltip = `${node.group.entries} related resources, ` +
    `${node.group.occurrences} occurrences`;
  return item;
}

/**
 * Return a concise group summary, using media types for assets.
 *
 * @param group - Relationship group
 *
 * @returns Formatted description string
 */
function groupDescription(group: VisibleRelationshipGroup): string {
  const kinds = group.assetKinds || [];
  if (!kinds.length) {
    return `${formatEntries(group.entries)} · ` +
      formatOccurrences(group.occurrences);
  }
  return `${kinds.map(formatAssetKind).join(" · ")} · ` +
    formatOccurrences(group.occurrences);
}

/**
 * Format one media-type count.
 *
 * @param asset - Asset kind and count
 *
 * @returns Formatted string
 */
function formatAssetKind(asset: AssetKindCount): string {
  const label = asset.kind === "other" ? "asset" : asset.kind;
  return `${asset.entries} ${label}${asset.entries === 1 ? "" : "s"}`;
}

/**
 * Format a count of entries with proper pluralization.
 *
 * @param count - Number of entries
 *
 * @returns Formatted string
 */
function formatEntries(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * Format a count of occurrences with proper pluralization.
 *
 * @param count - Number of occurrences
 *
 * @returns Formatted string
 */
function formatOccurrences(count: number): string {
  return `${count} ${count === 1 ? "occurrence" : "occurrences"}`;
}

/**
 * Render a tree item for a relationship entry.
 *
 * @param node - Entry node
 *
 * @returns Tree item
 */
function entryTreeItem(node: EntryNode): vscode.TreeItem {
  const related = node.entry.related;
  const occurrence = node.entry.occurrences[0];
  const label = related?.name || occurrence?.target || "Unresolved target";
  const item = new vscode.TreeItem(
    label,
    node.entry.occurrences.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  item.id = `entry:${node.group.kind}:${node.index}:${related?.uri ?? label}`;
  item.description = related ? subjectDescription(related) : undefined;
  item.iconPath = related
    ? new vscode.ThemeIcon(subjectIcon(related.kind))
    : new vscode.ThemeIcon("warning");
  item.contextValue = related
    ? "resolvedConnection"
    : "unresolvedConnection";
  item.tooltip = related
    ? `${related.name}\n${subjectDescription(related)}`
    : occurrence?.target;

  // Set the command to open the related resource or the authored occurrence
  if (related) {
    item.command = {
      command: "zensicalStudio.connections.open",
      title: "Open Related Resource",
      arguments: [related.uri, related.selectionRange],
    };
  } else if (occurrence) {
    item.command = {
      command: "zensicalStudio.connections.open",
      title: "Open Authored Occurrence",
      arguments: [occurrence.uri, occurrence.range],
    };
  }
  return item;
}

/**
 * Render a tree item for a relationship occurrence.
 *
 * @param node - Occurrence node
 *
 * @returns Tree item
 */
function occurrenceTreeItem(node: OccurrenceNode): vscode.TreeItem {
  const uri = vscode.Uri.parse(node.occurrence.uri);
  const item = new vscode.TreeItem(
    node.occurrence.target || `Line ${node.occurrence.range.start.line + 1}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `occurrence:${node.index}:${node.occurrence.uri}:` +
    `${node.occurrence.range.start.line}:${node.occurrence.range.start.character}`;
  item.description = `${vscode.workspace.asRelativePath(uri, false)}:` +
    `${node.occurrence.range.start.line + 1}`;
  item.iconPath = new vscode.ThemeIcon("location");
  item.contextValue = "connectionOccurrence";
  item.tooltip = `${node.occurrence.target}\n${item.description}`;
  item.command = {
    command: "zensicalStudio.connections.open",
    title: "Open Occurrence",
    arguments: [node.occurrence.uri, node.occurrence.range],
  };
  return item;
}

/**
 * Render a tree item for a "show more" placeholder.
 *
 * @param node - Show more node
 *
 * @returns Tree item
 */
function showMoreTreeItem(node: ShowMoreNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "Show more…",
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = `more:${node.group.kind}:${node.group.nextOffset}`;
  item.iconPath = new vscode.ThemeIcon("ellipsis");
  item.contextValue = "connectionMore";
  item.command = {
    command: "zensicalStudio.connections.more",
    title: "Show More",
    arguments: [node.group],
  };
  return item;
}

/**
 * Return the child nodes for a relationship group.
 *
 * @param group - Relationship group state
 *
 * @returns Array of relationship nodes
 */
function groupChildren(group: RelationshipGroupState): RelationshipNode[] {
  const children: RelationshipNode[] = group.items.map(
    (entry, index): EntryNode => ({ type: "entry", group, entry, index }),
  );
  if (group.nextOffset !== null) children.push({ type: "showMore", group });
  return children;
}

/**
 * Return a description for a relationship subject, using its path or URI.
 *
 * @param subject - Relationship subject
 *
 * @returns Description string
 */
function subjectDescription(subject: RelationshipSubject): string {
  return subject.path || resourceDescription(vscode.Uri.parse(subject.uri));
}

/**
 * Return a description for a resource URI, using its relative path.
 *
 * @param uri - Resource URI
 *
 * @returns Description string
 */
function resourceDescription(uri: vscode.Uri): string {
  const relative = vscode.workspace.asRelativePath(uri, false);
  return relative || uri.fsPath || uri.toString();
}

/**
 * Return an icon name for a relationship subject kind.
 *
 * @param kind - Relationship subject kind
 *
 * @returns Icon name string
 */
function subjectIcon(kind: RelationshipSubject["kind"]): string {
  switch (kind) {
    case "document":
      return "markdown";
    case "resource":
      return "file-media";
    case "heading":
      return "symbol-key";
    case "tab":
      return "list-tree";
    case "anchor":
      return "link";
    case "footnote":
      return "references";
    case "snippetSection":
      return "symbol-snippet";
  }
}

/**
 * Return the URI of the currently active resource.
 *
 * @returns Active resource URI or undefined
 */
function getActiveResource(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) return editor.document.uri;

  // Check the active tab group for a non-text editor input (e.g., a webview)
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input && typeof input === "object" && "uri" in input) {
    const uri = (input as { uri?: unknown }).uri;
    if (uri instanceof vscode.Uri) return uri;
  }
  return undefined;
}

/**
 * Open a resource URI in the editor, optionally selecting a range.
 *
 * @param uri - Resource URI to open
 * @param range - Optional range to select in the opened document
 */
async function openLocation(uri: string, range?: Range): Promise<void> {
  const resource = vscode.Uri.parse(uri);
  if (!range) {
    await vscode.commands.executeCommand("vscode.open", resource);
    return;
  }

  const selection = new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
  const editor = await vscode.window.showTextDocument(resource, {
    preview: true,
    selection,
  });
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
