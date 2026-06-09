import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxConfigurationError, booleanFlag, parseEnvFile, resolveDevId } from "../src/index.js";

describe("resolveDevId", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "identity-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("prefers the explicit id over every other source", () => {
    expect(resolveDevId({ devId: "alice", environment: { SANDBOX_DEV_ID: "bob" } })).toBe("alice");
  });

  it("reads the environment variable", () => {
    expect(resolveDevId({ environment: { SANDBOX_DEV_ID: "bob" } })).toBe("bob");
  });

  it("falls back to the environment file", () => {
    const envFile = path.join(directory, ".env");
    fs.writeFileSync(envFile, "SANDBOX_DEV_ID=carol\n");

    expect(resolveDevId({ envFile, environment: {} })).toBe("carol");
  });

  it("defaults to local", () => {
    expect(resolveDevId({ environment: {} })).toBe("local");
  });

  it("fails instead of defaulting when an id is required", () => {
    expect(() => resolveDevId({ environment: {}, require: true })).toThrow(SandboxConfigurationError);
  });

  it("rejects ids unusable in stack and container names", () => {
    expect(() => resolveDevId({ devId: "Bad Id!" })).toThrow(SandboxConfigurationError);
    expect(() => resolveDevId({ environment: { SANDBOX_DEV_ID: "UPPER" } })).toThrow(SandboxConfigurationError);
  });

  it("ignores a missing environment file", () => {
    expect(resolveDevId({ envFile: path.join(directory, "absent.env"), environment: {} })).toBe("local");
  });
});

describe("parseEnvFile", () => {
  it("skips blank lines and comments, splits on the first equals sign", () => {
    const parsed = parseEnvFile(["# comment", "", "KEY=value", "URL=postgresql://u:p@h/db?a=b"].join("\n"));

    expect(parsed).toEqual({ KEY: "value", URL: "postgresql://u:p@h/db?a=b" });
  });

  it("trims keys and values", () => {
    expect(parseEnvFile("  KEY =  value  ")).toEqual({ KEY: "value" });
  });

  it("ignores lines without a key", () => {
    expect(parseEnvFile("=value\nnoequals")).toEqual({});
  });
});

describe("booleanFlag", () => {
  it("accepts the usual truthy and falsy spellings", () => {
    for (const value of ["true", "1", "yes", "ON"]) {
      expect(booleanFlag(value, false)).toBe(true);
    }
    for (const value of ["false", "0", "no", "OFF"]) {
      expect(booleanFlag(value, true)).toBe(false);
    }
  });

  it("returns the default for missing or unrecognized values", () => {
    expect(booleanFlag(undefined, true)).toBe(true);
    expect(booleanFlag("maybe", false)).toBe(false);
  });
});
