import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderChromeBookmarksHtml, writeChromeBookmarks } from "../src/plugins/bookmarks.js";

describe("renderChromeBookmarksHtml", () => {
  it("groups entries into sub-folders under the root folder", () => {
    const html = renderChromeBookmarksHtml(
      [
        { name: "Mail catcher", url: "http://localhost:25080", group: "Tools" },
        { name: "Identity console", url: "http://localhost:25081", group: "Tools" },
        { name: "Application", url: "http://localhost:8080", group: "Services" },
      ],
      "Shop Sandbox",
    );

    expect(html).toContain("<DT><H3>Shop Sandbox</H3>");
    expect(html).toContain("<DT><H3>Tools</H3>");
    expect(html).toContain("<DT><H3>Services</H3>");
    expect(html).toContain(`<DT><A HREF="http://localhost:25080">Mail catcher</A>`);
  });

  it("places ungrouped entries under a default sub-folder", () => {
    const html = renderChromeBookmarksHtml([{ name: "Application", url: "http://localhost:8080" }]);

    expect(html).toContain("<DT><H3>Sandbox</H3>");
    expect(html).toContain(`<DT><A HREF="http://localhost:8080">Application</A>`);
  });

  it("escapes HTML-significant characters in names and URLs", () => {
    const html = renderChromeBookmarksHtml([
      { name: `a<b>&"c`, url: "http://localhost:8080?a=1&b=2" },
    ]);

    expect(html).toContain(`>a&lt;b&gt;&amp;&quot;c</A>`);
    expect(html).toContain(`HREF="http://localhost:8080?a=1&amp;b=2"`);
  });

  it("starts with the Netscape bookmark file doctype Chrome expects", () => {
    const html = renderChromeBookmarksHtml([]);

    expect(html.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>")).toBe(true);
  });
});

describe("writeChromeBookmarks", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-bookmarks-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("creates the directory and writes bookmarks.html with the given root folder", () => {
    const target = path.join(directory, "generated");
    const entries = [{ name: "Application", url: "http://localhost:8080" }];
    writeChromeBookmarks(target, entries, "Shop Sandbox");

    expect(fs.readFileSync(path.join(target, "bookmarks.html"), "utf-8")).toBe(
      renderChromeBookmarksHtml(entries, "Shop Sandbox"),
    );
  });
});
