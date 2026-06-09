import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvironmentFile, EnvironmentFileError } from "../src/index.js";

describe("EnvironmentFile", () => {
  it("renders groups separated by blank lines, in insertion order", () => {
    const file = new EnvironmentFile([{ APP_PORT: 8080, APP_NAME: "shop" }]);
    file.add({ DATABASE_URL: "postgresql://localhost:5432/shop" });

    expect(file.render()).toBe(
      ["APP_PORT=8080", "APP_NAME=shop", "", "DATABASE_URL=postgresql://localhost:5432/shop", ""].join("\n"),
    );
  });

  it("overwrites an existing key in place instead of duplicating it", () => {
    const file = new EnvironmentFile([{ APP_PORT: 8080 }]);
    file.add({ APP_PORT: 9090, APP_NAME: "shop" });

    expect(file.render()).toBe(["APP_PORT=9090", "", "APP_NAME=shop", ""].join("\n"));
  });

  it("adds no separator for a group that only overwrites", () => {
    const file = new EnvironmentFile([{ APP_PORT: 8080 }]);
    file.add({ APP_PORT: 9090 });

    expect(file.render()).toBe("APP_PORT=9090\n");
  });

  it("renders an empty string as a commented-out entry", () => {
    const file = new EnvironmentFile([{ OPTIONAL_TOKEN: "" }]);

    expect(file.render()).toBe("# OPTIONAL_TOKEN=\n");
  });

  it("serializes objects and arrays as JSON", () => {
    const file = new EnvironmentFile([{ ROUTES: { "/api": "localhost:9090" }, FLAGS: ["a", "b"] }]);

    expect(file.values()).toEqual({
      ROUTES: '{"/api":"localhost:9090"}',
      FLAGS: '["a","b"]',
    });
  });

  it("stringifies booleans and numbers", () => {
    const file = new EnvironmentFile([{ ENABLED: true, RETRIES: 3 }]);

    expect(file.values()).toEqual({ ENABLED: "true", RETRIES: "3" });
  });

  it("collapses consecutive separators", () => {
    const file = new EnvironmentFile([{ A: "1" }]);
    file.addSeparator().addSeparator();
    file.add({ B: "2" });

    expect(file.render()).toBe(["A=1", "", "B=2", ""].join("\n"));
  });

  it("rejects undefined and null values with the offending key", () => {
    const file = new EnvironmentFile();

    expect(() => file.add({ BROKEN: undefined as unknown as string })).toThrow(EnvironmentFileError);
    expect(() => file.add({ BROKEN: null as unknown as string })).toThrow(/BROKEN/);
  });

  it("rejects unresolved Pulumi outputs with a pointer to deepResolve", () => {
    const file = new EnvironmentFile();
    const output = pulumi.output("secret");

    expect(() => file.add({ SECRET: output })).toThrow(/deepResolve/);
  });

  it("rejects functions", () => {
    const file = new EnvironmentFile();

    expect(() => file.add({ CALLBACK: (() => "x") as unknown as string })).toThrow(EnvironmentFileError);
  });

  it("omits commented-out empty values from values(), mirroring render()", () => {
    const file = new EnvironmentFile([{ OPTIONAL_TOKEN: "", ACTIVE: "yes" }]);

    expect(file.values()).toEqual({ ACTIVE: "yes" });
    expect(file.render()).toContain("# OPTIONAL_TOKEN=");
  });

  it("rejects invalid variable names", () => {
    const file = new EnvironmentFile();

    expect(() => file.add({ "BAD-NAME": "x" })).toThrow(EnvironmentFileError);
  });

  it("rejects values containing newlines", () => {
    const file = new EnvironmentFile([{ MULTILINE: "a\nb" }]);

    expect(() => file.render()).toThrow(/newline/);
  });

  describe("write", () => {
    let directory: string;

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "environment-file-"));
    });

    afterEach(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    it("creates parent directories and writes the rendered content", () => {
      const target = path.join(directory, "nested", "application.env");
      new EnvironmentFile([{ A: "1" }]).write(target);

      expect(fs.readFileSync(target, "utf-8")).toBe("A=1\n");
    });
  });
});
