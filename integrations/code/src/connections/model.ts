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

import type { Range } from "vscode-languageserver-types";

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * Kinds of relationship groups.
 */
export type RelationshipGroupKind =
  | "incomingLinks"
  | "outgoingLinks"
  | "includes"
  | "includedBy"
  | "assets"
  | "usedBy"
  | "unresolvedLinks"
  | "unresolvedIncludes"
  | "unresolvedAssets";

/**
 * Kinds of relationship subjects.
 */
export type RelationshipSubjectKind =
  | "document"
  | "resource"
  | "heading"
  | "tab"
  | "anchor"
  | "footnote"
  | "snippetSection";

/**
 * Relationship subject.
 */
export interface RelationshipSubject {
  uri: string;
  path?: string;
  anchor?: string;
  kind: RelationshipSubjectKind;
  name: string;
  selectionRange?: Range;
}

/**
 * Relationship group summary.
 */
export interface RelationshipGroupSummary {
  kind: RelationshipGroupKind;
  entries: number;
  occurrences: number;
}

/**
 * Relationship summary for a subject.
 */
export interface ConnectionsSummary {
  version: 1;
  subject: RelationshipSubject;
  groups: RelationshipGroupSummary[];
}

/**
 * Relationship occurrence.
 */
export interface RelationshipOccurrence {
  uri: string;
  range: Range;
  target: string;
}

/**
 * Relationship entry for a subject.
 */
export interface RelationshipEntry {
  related: RelationshipSubject | null;
  occurrences: RelationshipOccurrence[];
}

/**
 * Relationship entries for a subject and group.
 */
export interface RelationshipEntries {
  version: 1;
  subject: RelationshipSubject;
  group: RelationshipGroupKind;
  entries: number;
  occurrences: number;
  items: RelationshipEntry[];
  nextOffset: number | null;
}

/**
 * Relationship section definition.
 */
export interface RelationshipSection {
  label: string;
  icon: string;
  groups: RelationshipGroupDefinition[];
}

/**
 * Relationship group definition.
 */
export interface RelationshipGroupDefinition {
  kind: RelationshipGroupKind;
  label: string;
  icon: string;
  flat?: boolean;
}

/**
 * Visible relationship group.
 */
export interface VisibleRelationshipGroup extends RelationshipGroupDefinition {
  entries: number;
  occurrences: number;
}

/**
 * Visible relationship section.
 */
export interface VisibleRelationshipSection {
  label: string;
  icon: string;
  groups: VisibleRelationshipGroup[];
}

/* ----------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------- */

/**
 * Relationship sections in their fixed display order.
 */
export const relationshipSections: RelationshipSection[] = [
  {
    label: "Links",
    icon: "link",
    groups: [
      { kind: "incomingLinks", label: "Incoming", icon: "arrow-small-left" },
      { kind: "outgoingLinks", label: "Outgoing", icon: "arrow-small-right" },
    ],
  },
  {
    label: "Content",
    icon: "list-tree",
    groups: [
      { kind: "includes", label: "Includes", icon: "arrow-small-down" },
      { kind: "includedBy", label: "Included by", icon: "arrow-small-up" },
    ],
  },
  {
    label: "Assets",
    icon: "file-media",
    groups: [
      { kind: "assets", label: "Assets", icon: "file-media", flat: true },
      { kind: "usedBy", label: "Used by", icon: "references" },
    ],
  },
  {
    label: "Needs attention",
    icon: "warning",
    groups: [
      { kind: "unresolvedLinks", label: "Unresolved links", icon: "warning" },
      {
        kind: "unresolvedIncludes",
        label: "Unresolved inclusions",
        icon: "warning",
      },
      { kind: "unresolvedAssets", label: "Unresolved assets", icon: "warning" },
    ],
  },
];

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Build the non-empty relationship sections in their fixed display order.
 *
 * @param groups - Relationship group summaries
 *
 * @returns Visible relationship sections
 */
export function getVisibleSections(
  groups: RelationshipGroupSummary[],
): VisibleRelationshipSection[] {
  const summaries = new Map(groups.map((group) => [group.kind, group]));
  return relationshipSections.flatMap((section) => {
    const visible = section.groups.flatMap((definition) => {
      const summary = summaries.get(definition.kind);
      if (!summary || summary.entries === 0) return [];
      return [{ ...definition, ...summary }];
    });
    return visible.length
      ? [{ label: section.label, icon: section.icon, groups: visible }]
      : [];
  });
}
