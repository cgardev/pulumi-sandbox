/**
 * IntelliJ data-source generation — renders `.idea/dataSources.xml` and
 * `.idea/dataSources.local.xml` so the databases a sandbox provisions appear
 * pre-configured in the IDE. Nothing in this module touches Pulumi; feed it
 * resolved outputs.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Single IntelliJ data-source entry produced by the sandbox. Postgres-only —
 * the driver is hardcoded because every sandbox database is Postgres (or a
 * Postgres-protocol clone like TimescaleDB).
 */
export interface DataSourceDefinition {
  /** Display name + IntelliJ resource name; must stay stable across regenerations. */
  name: string;

  /** Full JDBC URL, e.g. `jdbc:postgresql://localhost:25432/orders`. */
  jdbcUrl: string;

  /** Database user IntelliJ should default to. */
  userName: string;

  /**
   * Database password. When provided, it is URL-encoded and appended to the
   * JDBC URL as `?user=...&password=...` so IntelliJ skips the credential
   * prompt entirely (the Postgres driver consumes the URL parameters
   * directly). Only safe for sandbox stacks with throwaway credentials — the
   * password ends up in plaintext inside `.idea/dataSources.xml`.
   */
  password?: string;
}

/**
 * Renders `.idea/dataSources.xml` — the shared half of an IntelliJ data
 * source: name, driver, JDBC URL. UUIDs are derived from the name so they
 * line up with {@link renderDataSourcesLocalXml}.
 */
export function renderDataSourcesXml(definitions: readonly DataSourceDefinition[]): string {
  return projectXml(
    `<component name="DataSourceManagerImpl" format="xml" multifile-model="true">`,
    definitions.map(sharedEntryXml),
  );
}

/**
 * Renders `.idea/dataSources.local.xml` — the per-developer half of an
 * IntelliJ data source: user name, secret storage, introspection scope. The
 * UUID is derived the same way as in {@link renderDataSourcesXml} so the two
 * files cross-reference.
 */
export function renderDataSourcesLocalXml(definitions: readonly DataSourceDefinition[]): string {
  return projectXml(`<component name="dataSourceStorageLocal">`, definitions.map(localEntryXml));
}

/**
 * Writes both `dataSources.xml` and `dataSources.local.xml` under the given
 * IntelliJ project directory (typically `<repository>/.idea`). Creates the
 * directory if it does not exist.
 */
export function writeIntellijDataSources(
  ideaDir: string,
  definitions: readonly DataSourceDefinition[],
): void {
  fs.mkdirSync(ideaDir, { recursive: true });
  fs.writeFileSync(path.join(ideaDir, "dataSources.xml"), renderDataSourcesXml(definitions));
  fs.writeFileSync(path.join(ideaDir, "dataSources.local.xml"), renderDataSourcesLocalXml(definitions));
}

function sharedEntryXml(definition: DataSourceDefinition): readonly string[] {
  const uuid = deterministicUuid(definition.name);
  const url = embedCredentialsInJdbcUrl(definition.jdbcUrl, definition.userName, definition.password);
  return [
    `    <data-source source="LOCAL" name="${escapeXml(definition.name)}" uuid="${uuid}">`,
    `      <driver-ref>postgresql</driver-ref>`,
    `      <synchronize>true</synchronize>`,
    `      <jdbc-driver>org.postgresql.Driver</jdbc-driver>`,
    `      <jdbc-url>${escapeXml(url)}</jdbc-url>`,
    `      <jdbc-additional-properties>`,
    `        <property name="com.intellij.clouds.kubernetes.db.host.port" />`,
    `        <property name="com.intellij.clouds.kubernetes.db.enabled" value="false" />`,
    `        <property name="com.intellij.clouds.kubernetes.db.container.port" />`,
    `      </jdbc-additional-properties>`,
    `      <working-dir>$ProjectFileDir$</working-dir>`,
    `    </data-source>`,
  ];
}

// The empty database-info is intentional: IntelliJ overwrites it with real
// values on first connection.
function localEntryXml(definition: DataSourceDefinition): readonly string[] {
  return [
    `    <data-source name="${escapeXml(definition.name)}" uuid="${deterministicUuid(definition.name)}">`,
    `      <database-info product="" version="" jdbc-version=""` +
      ` driver-name="" driver-version="" dbms="POSTGRES" />`,
    `      <secret-storage>master_key</secret-storage>`,
    `      <user-name>${escapeXml(definition.userName)}</user-name>`,
    `      <schema-mapping>`,
    `        <introspection-scope>`,
    `          <node kind="database" negative="1">`,
    `            <node kind="schema" negative="1" />`,
    `          </node>`,
    `        </introspection-scope>`,
    `      </schema-mapping>`,
    `    </data-source>`,
  ];
}

/** Wraps rendered data-source entries in the `.idea` project-file envelope. */
function projectXml(componentTag: string, entries: ReadonlyArray<readonly string[]>): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<project version="4">`,
    `  ${componentTag}`,
    ...entries.flat(),
    `  </component>`,
    `</project>`,
    ``,
  ].join("\n");
}

/**
 * Appends `user` / `password` query parameters to a JDBC URL so the Postgres
 * driver can authenticate without prompting. Returns the original URL when
 * `password` is undefined.
 */
function embedCredentialsInJdbcUrl(
  jdbcUrl: string,
  userName: string,
  password: string | undefined,
): string {
  if (password === undefined) {
    return jdbcUrl;
  }
  const separator = jdbcUrl.includes("?") ? "&" : "?";
  const credentials = `user=${encodeURIComponent(userName)}&password=${encodeURIComponent(password)}`;
  return `${jdbcUrl}${separator}${credentials}`;
}

/**
 * SHA-1-based UUIDv5-style identifier derived from the data-source name. The
 * point is stability: every regeneration of the XML produces the same UUID
 * for the same name, so IntelliJ's introspection cache (keyed by UUID in
 * `dataSources.local.xml`) survives a sandbox reset.
 *
 * Not a strict RFC-4122 UUIDv5 (no namespace argument), but the format passes
 * IntelliJ's parser and that is all that matters here.
 */
function deterministicUuid(name: string): string {
  const hash = createHash("sha1").update(`pulumi-sandbox:${name}`).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(`"`, "&quot;");
}
