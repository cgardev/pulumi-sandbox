import * as pulumi from "@pulumi/pulumi";

/** The shape of `T` after every nested Pulumi output and promise has resolved. */
export type DeepResolved<T> =
  T extends pulumi.Output<infer U>
    ? DeepResolved<U>
    : T extends Promise<infer U>
      ? DeepResolved<U>
      : T extends ReadonlyArray<infer E>
        ? DeepResolved<E>[]
        : T extends (...args: never[]) => unknown
          ? T
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
 */
export function deepResolve<T>(value: T): pulumi.Output<DeepResolved<T>> {
  return pulumi.output(resolveUnknown(value)) as pulumi.Output<DeepResolved<T>>;
}

function resolveUnknown(value: unknown): pulumi.Input<unknown> {
  if (pulumi.Output.isInstance(value) || value instanceof Promise) {
    return pulumi.output(value).apply(resolveUnknown);
  }
  if (Array.isArray(value)) {
    return pulumi.all(value.map(resolveUnknown));
  }
  if (isPlainObject(value)) {
    const resolved: Record<string, pulumi.Input<unknown>> = {};
    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = resolveUnknown(entry);
    }
    return pulumi.all(resolved);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
