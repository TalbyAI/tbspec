import { createHash } from "node:crypto";

export function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
export function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new TypeError("Unpaired Unicode surrogate.");
    const escaped = [...value]
      .map((char) => {
        if (char === '"') return '\\"';
        if (char === "\\") return "\\\\";
        const code = char.charCodeAt(0);
        return code < 32 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
      })
      .join("");
    return `"${escaped}"`;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(utf8Compare)
      .map((key) => `${canonical(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(
    "Canonical values require strings, safe integers, booleans, null, arrays or plain objects.",
  );
}
export function digest(bytes: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function hash(value: unknown): string {
  return digest(canonical(value));
}
export function sortedSet<T>(values: T[]): T[] {
  const pairs = values
    .map((value) => ({ value, key: canonical(value) }))
    .sort((a, b) => utf8Compare(a.key, b.key));
  for (let i = 1; i < pairs.length; i++)
    if (pairs[i]?.key === pairs[i - 1]?.key) throw new TypeError("Duplicate set member.");
  return pairs.map((pair) => pair.value);
}
export function graphSignature(file: {
  byte_digest: string;
  media_type: string;
  base_iri: string;
  parser_profile: string;
}): string {
  return hash([
    "tbspec.graph",
    1,
    file.byte_digest,
    file.media_type,
    file.base_iri,
    file.parser_profile,
  ]);
}
