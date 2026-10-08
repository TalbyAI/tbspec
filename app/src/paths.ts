import type { Stats } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { hasCode, ProjectError } from "./output.ts";

export function portablePath(value: string): string {
  const path = value.replaceAll("\\", "/");
  const components = path.split("/");
  if (
    !path.isWellFormed() ||
    components.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*]/.test(part) ||
        [...part].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        /[ .]$/.test(part) ||
        /^(con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
    )
  ) {
    throw new ProjectError(
      "invalid_arguments",
      "PATH_UNSAFE",
      `Unsafe project-relative path: ${value}`,
    );
  }
  return path;
}
export function id(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value))
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", `Invalid ID: ${value}`);
  return portablePath(value);
}
export function absoluteIri(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.isWellFormed() &&
    /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>"{}|^`\\]*$/u.test(value) &&
    !/%(?![0-9A-Fa-f]{2})/.test(value) &&
    ![...value].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 32 || (code >= 127 && code <= 159);
    })
  );
}
export async function safePath(root: string, value: string, writable = false): Promise<string> {
  const path = portablePath(value);
  let parent = root;
  for (const component of path.split("/")) {
    let entries: string[];
    try {
      entries = await readdir(parent);
    } catch (error) {
      if (hasCode(error, "ENOENT")) break;
      throw error;
    }
    // Reject case-equivalent names on every platform, including case-sensitive Windows directories.
    if (
      entries.some(
        (entry) => entry !== component && entry.toLowerCase() === component.toLowerCase(),
      )
    ) {
      throw new ProjectError(
        "conflict",
        "PATH_UNSAFE",
        `Platform-equivalent path collision: ${path}`,
        path,
      );
    }
    parent = join(parent, component);
    let info: Stats;
    try {
      info = await lstat(parent);
    } catch (error) {
      if (hasCode(error, "ENOENT")) break;
      throw error;
    }
    if (
      info.isSymbolicLink() ||
      (!info.isFile() && !info.isDirectory()) ||
      (writable && info.isFile() && info.nlink !== 1)
    ) {
      throw new ProjectError(
        "conflict",
        "PATH_UNSAFE",
        `Links or special files are not supported: ${path}`,
        path,
      );
    }
    const actual = await realpath(parent);
    const fromRoot = relative(root, actual);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || /^[A-Za-z]:/.test(fromRoot))
      throw new ProjectError("conflict", "PATH_UNSAFE", `Path escapes the project: ${path}`, path);
    if (process.platform === "win32" && actual.toLowerCase() !== parent.toLowerCase())
      throw new ProjectError("conflict", "PATH_UNSAFE", `Filesystem alias: ${path}`, path);
  }
  return join(root, ...path.split("/"));
}
