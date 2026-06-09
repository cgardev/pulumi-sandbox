/**
 * Host-side docker utilities — attaching shells, executing post-boot
 * configuration, and discovering mask volumes. Nothing in this module
 * touches Pulumi; it complements the resources a program declares.
 */

export { attachShell } from "./shell.js";
export type { AttachShellOptions } from "./shell.js";

export { dockerExec } from "./exec.js";
export type { DockerExecOptions } from "./exec.js";

export { discoverMaskVolumes } from "./mask-volumes.js";
export type { MaskVolume, MaskRule, DiscoverMaskVolumesOptions } from "./mask-volumes.js";
