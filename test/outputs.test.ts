import * as pulumi from "@pulumi/pulumi";
import { describe, expect, it } from "vitest";
import { deepResolve } from "../src/index.js";

function valueOf<T>(output: pulumi.Output<T>): Promise<T> {
  return new Promise((resolve) => {
    output.apply((value) => {
      resolve(value);
      return value;
    });
  });
}

describe("deepResolve", () => {
  it("resolves outputs nested inside objects and arrays", async () => {
    const value = {
      port: 5432,
      credentials: {
        user: pulumi.output("dev"),
        password: Promise.resolve("secret"),
      },
      endpoints: [pulumi.output("http://localhost:8080"), "http://localhost:9090"],
    };

    await expect(valueOf(deepResolve(value))).resolves.toEqual({
      port: 5432,
      credentials: { user: "dev", password: "secret" },
      endpoints: ["http://localhost:8080", "http://localhost:9090"],
    });
  });

  it("resolves outputs that themselves contain outputs", async () => {
    const nested = pulumi.output({ inner: pulumi.output("value") });

    await expect(valueOf(deepResolve(nested))).resolves.toEqual({ inner: "value" });
  });

  it("passes plain values through untouched", async () => {
    await expect(valueOf(deepResolve("plain"))).resolves.toBe("plain");
  });
});
