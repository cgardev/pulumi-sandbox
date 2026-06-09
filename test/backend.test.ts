import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileBackendUrl, resolveDirectories } from "../src/index.js";

describe("fileBackendUrl", () => {
  it("renders a POSIX path with three slashes", () => {
    expect(fileBackendUrl("/home/dev/project/.sandbox/state")).toBe("file:///home/dev/project/.sandbox/state");
  });

  it("renders a Windows path with two slashes and forward slashes", () => {
    // Pulumi's DIY backend mis-parses file:///D:/... on Windows; file://D:/... is the accepted form.
    expect(fileBackendUrl("D:\\projects\\shop\\.sandbox\\state")).toBe("file://D:/projects/shop/.sandbox/state");
  });
});

describe("resolveDirectories", () => {
  it("scopes the work directory per project and shares the state directory", () => {
    const directories = resolveDirectories(".sandbox", "shop");

    expect(directories.state).toBe(path.resolve(".sandbox", "state"));
    expect(directories.work).toBe(path.resolve(".sandbox", "work", "shop"));
  });
});
