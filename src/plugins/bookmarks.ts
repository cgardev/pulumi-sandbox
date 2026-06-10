/**
 * Browser bookmark generation — renders the consoles and dashboards a sandbox
 * exposes as a Chrome-importable bookmarks file (Netscape Bookmark File
 * Format). Nothing in this module touches Pulumi; feed it resolved outputs.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * One entry in the Chrome bookmarks output: a name, a URL, and an optional
 * group label that turns into a bookmark sub-folder.
 */
export interface BookmarkEntry {
  /** Display name in the bookmarks bar. */
  name: string;

  /** URL the bookmark opens. */
  url: string;

  /** Optional grouping label — becomes a sub-folder under the root folder. */
  group?: string;
}

const DEFAULT_GROUP = "Sandbox";
const DEFAULT_ROOT_FOLDER = "Sandbox";

/**
 * Renders a Chrome-importable bookmarks file (Netscape Bookmark File Format).
 * Each {@link BookmarkEntry.group} becomes a sub-folder under `rootFolder`.
 *
 * Import via Chrome: `chrome://bookmarks` → ⋮ → Import bookmarks → pick the
 * generated file.
 */
export function renderChromeBookmarksHtml(
  entries: readonly BookmarkEntry[],
  rootFolder: string = DEFAULT_ROOT_FOLDER,
): string {
  return [
    `<!DOCTYPE NETSCAPE-Bookmark-file-1>`,
    `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">`,
    `<TITLE>Bookmarks</TITLE>`,
    `<H1>Bookmarks</H1>`,
    `<DL><p>`,
    `    <DT><H3>${escapeHtml(rootFolder)}</H3>`,
    `    <DL><p>`,
    ...[...groupEntries(entries)].flatMap(folderHtml),
    `    </DL><p>`,
    `</DL><p>`,
    ``,
  ].join("\n");
}

/**
 * Writes the Chrome bookmarks file (`bookmarks.html`) into the given
 * directory. Creates the directory if missing.
 */
export function writeChromeBookmarks(
  outputDir: string,
  entries: readonly BookmarkEntry[],
  rootFolder: string = DEFAULT_ROOT_FOLDER,
): void {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "bookmarks.html"), renderChromeBookmarksHtml(entries, rootFolder));
}

function groupEntries(entries: readonly BookmarkEntry[]): Map<string, BookmarkEntry[]> {
  const grouped = new Map<string, BookmarkEntry[]>();
  for (const entry of entries) {
    const group = entry.group ?? DEFAULT_GROUP;
    const members = grouped.get(group);
    if (members) {
      members.push(entry);
    } else {
      grouped.set(group, [entry]);
    }
  }
  return grouped;
}

function folderHtml([group, members]: readonly [string, readonly BookmarkEntry[]]): readonly string[] {
  return [
    `        <DT><H3>${escapeHtml(group)}</H3>`,
    `        <DL><p>`,
    ...members.map(bookmarkHtml),
    `        </DL><p>`,
  ];
}

function bookmarkHtml(entry: BookmarkEntry): string {
  return `            <DT><A HREF="${escapeHtml(entry.url)}">${escapeHtml(entry.name)}</A>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(`"`, "&quot;");
}
