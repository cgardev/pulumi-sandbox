import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  renderDataSourcesLocalXml,
  renderDataSourcesXml,
  writeIntellijDataSources,
} from "../src/plugins/intellij.js";
import type { DataSourceDefinition } from "../src/plugins/intellij.js";

const ORDERS: DataSourceDefinition = {
  name: "orders",
  jdbcUrl: "jdbc:postgresql://localhost:25432/orders",
  userName: "dev",
};

describe("renderDataSourcesXml", () => {
  it("renders one data-source entry per definition with the Postgres driver", () => {
    const xml = renderDataSourcesXml([ORDERS]);

    expect(xml).toContain(`name="orders"`);
    expect(xml).toContain("<driver-ref>postgresql</driver-ref>");
    expect(xml).toContain("<jdbc-url>jdbc:postgresql://localhost:25432/orders</jdbc-url>");
  });

  it("derives the same UUID for the same name on every render", () => {
    const first = renderDataSourcesXml([ORDERS]);
    const second = renderDataSourcesXml([ORDERS]);

    expect(first).toBe(second);
    expect(first).toMatch(/uuid="[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}"/);
  });

  it("embeds URL-encoded credentials when a password is provided", () => {
    const xml = renderDataSourcesXml([{ ...ORDERS, password: "p@ss word" }]);

    expect(xml).toContain(
      "<jdbc-url>jdbc:postgresql://localhost:25432/orders?user=dev&amp;password=p%40ss%20word</jdbc-url>",
    );
  });

  it("appends credentials with & when the URL already has query parameters", () => {
    const xml = renderDataSourcesXml([
      { ...ORDERS, jdbcUrl: "jdbc:postgresql://localhost:25432/orders?sslmode=disable", password: "x" },
    ]);

    expect(xml).toContain("orders?sslmode=disable&amp;user=dev&amp;password=x</jdbc-url>");
  });

  it("escapes XML-significant characters in names", () => {
    const xml = renderDataSourcesXml([{ ...ORDERS, name: `a<b>&"c` }]);

    expect(xml).toContain(`name="a&lt;b&gt;&amp;&quot;c"`);
  });
});

describe("renderDataSourcesLocalXml", () => {
  it("uses the same UUID as the shared file so the two halves cross-reference", () => {
    const shared = renderDataSourcesXml([ORDERS]);
    const local = renderDataSourcesLocalXml([ORDERS]);

    const uuid = shared.match(/uuid="([^"]+)"/)?.[1];
    expect(uuid).toBeDefined();
    expect(local).toContain(`uuid="${uuid}"`);
  });

  it("renders the user name and leaves database-info empty for IntelliJ to fill", () => {
    const local = renderDataSourcesLocalXml([ORDERS]);

    expect(local).toContain("<user-name>dev</user-name>");
    expect(local).toContain(`<database-info product="" version=""`);
  });
});

describe("writeIntellijDataSources", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "intellij-data-sources-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("creates the directory and writes both files", () => {
    const ideaDir = path.join(directory, ".idea");
    writeIntellijDataSources(ideaDir, [ORDERS]);

    expect(fs.readFileSync(path.join(ideaDir, "dataSources.xml"), "utf-8")).toBe(
      renderDataSourcesXml([ORDERS]),
    );
    expect(fs.readFileSync(path.join(ideaDir, "dataSources.local.xml"), "utf-8")).toBe(
      renderDataSourcesLocalXml([ORDERS]),
    );
  });
});
