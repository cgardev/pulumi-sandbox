import * as pulumi from "@pulumi/pulumi";
import { SandboxError } from "./errors.js";

/** The shape of `T` after every nested Pulumi output and promise has resolved. */
export type DeepResolved<T> =
  T extends pulumi.Output<infer U>
    ? DeepResolved<U>
    : T extends Promise<infer U>
      ? DeepResolved<U>
      : T extends ReadonlyArray<infer E>
        ? DeepResolved<E>[]
        : T extends object
          ? { [K in keyof T]: DeepResolved<T[K]> }
          : T;

/**
 * Resolves every Pulumi output nested anywhere inside a plain value — arrays,
 * objects, and promises included — into a single output of the fully
 * concrete shape.
 *
 * This is the bridge between resource graphs and host-side side effects:
 * collect generated credentials, ports, and endpoints into one structure,
 * deep-resolve it, and render environment files or developer artifacts in a
 * single `apply`:
 *
 * ```typescript
 * deepResolve({ clientSecret: client.clientSecret, port: 5432 }).apply((resolved) => {
 *   env.add(resolved);
 *   env.write("application/.env.local");
 * });
 * ```
 *
 * The value must be plain data: primitives, arrays, plain objects, promises,
 * and outputs, nested arbitrarily. Class instances and circular references
 * are rejected with an error naming the offending path — Pulumi's output
 * machinery would otherwise silently flatten an instance into a plain bag
 * of properties.
 */
export function deepResolve<T>(value: T): pulumi.Output<DeepResolved<T>> {
  return pulumi.output(resolveUnknown(value, "value", new WeakSet())) as pulumi.Output<DeepResolved<T>>;
}

function resolveUnknown(value: unknown, path: string, visiting: WeakSet<object>): pulumi.Input<unknown> {
  if (pulumi.Output.isInstance(value) || value instanceof Promise) {
    return pulumi.output(value).apply((inner) => resolveUnknown(inner, path, visiting));
  }
  if (Array.isArray(value)) {
    enterValue(value, path, visiting);
    const resolved = pulumi.all(value.map((entry, index) => resolveUnknown(entry, `${path}[${index}]`, visiting)));
    visiting.delete(value);
    return resolved;
  }
  if (typeof value === "object" && value !== null) {
    if (!isPlainObject(value)) {
      throw new SandboxError(
        `deepResolve only accepts plain data, but ${path} is an instance of ${value.constructor?.name ?? "an unknown class"}.`,
      );
    }
    enterValue(value, path, visiting);
    const resolved: Record<string, pulumi.Input<unknown>> = {};
    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = resolveUnknown(entry, `${path}.${key}`, visiting);
    }
    visiting.delete(value);
    return pulumi.all(resolved);
  }
  if (typeof value === "function") {
    throw new SandboxError(`deepResolve only accepts plain data, but ${path} is a function.`);
  }
  return value;
}

function enterValue(value: object, path: string, visiting: WeakSet<object>): void {
  if (visiting.has(value)) {
    throw new SandboxError(`deepResolve found a circular reference at ${path}.`);
  }
  visiting.add(value);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
