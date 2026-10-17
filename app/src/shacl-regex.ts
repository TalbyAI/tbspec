import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { compile as compileXmlSchemaPattern } from "xspattern";

const require = createRequire(import.meta.url);
const unicodeRoot = dirname(require.resolve("@unicode/unicode-15.0.0/package.json"));
const blockRoot = join(unicodeRoot, "Block");
const normalize = (value: string) => value.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
const blocks = new Map(
  readdirSync(blockRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [normalize(entry.name), entry.name]),
);
const blockAliases = new Map([
  ["greek", "Greek_And_Coptic"],
  ["combiningmarksforsymbols", "Combining_Diacritical_Marks_For_Symbols"],
  ["privateuse", "Private_Use_Area"],
]);
const propertyCache = new Map<string, RegExp>();
const categories: Record<string, string> = {
  L: "Letter",
  Lu: "Uppercase_Letter",
  Ll: "Lowercase_Letter",
  Lt: "Titlecase_Letter",
  Lm: "Modifier_Letter",
  Lo: "Other_Letter",
  M: "Mark",
  Mn: "Nonspacing_Mark",
  Mc: "Spacing_Mark",
  Me: "Enclosing_Mark",
  N: "Number",
  Nd: "Decimal_Number",
  Nl: "Letter_Number",
  No: "Other_Number",
  P: "Punctuation",
  Pc: "Connector_Punctuation",
  Pd: "Dash_Punctuation",
  Ps: "Open_Punctuation",
  Pe: "Close_Punctuation",
  Pi: "Initial_Punctuation",
  Pf: "Final_Punctuation",
  Po: "Other_Punctuation",
  S: "Symbol",
  Sm: "Math_Symbol",
  Sc: "Currency_Symbol",
  Sk: "Modifier_Symbol",
  So: "Other_Symbol",
  Z: "Separator",
  Zs: "Space_Separator",
  Zl: "Line_Separator",
  Zp: "Paragraph_Separator",
  C: "Other",
  Cc: "Control",
  Cf: "Format",
  Cs: "Surrogate",
  Co: "Private_Use",
  Cn: "Unassigned",
};
const nameStartRanges = [
  [0x3a, 0x3a],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
] as const;
const codePoint = (value: number) => "\\u{" + value.toString(16) + "}";
const ranges = (pairs: readonly (readonly [number, number])[]) =>
  pairs
    .map(([start, end]) =>
      start === end ? codePoint(start) : codePoint(start) + "-" + codePoint(end),
    )
    .join("");
const nameStartClass = ranges(nameStartRanges);
const nameCharClass =
  nameStartClass +
  ranges([
    [0x2d, 0x2e],
    [0x30, 0x39],
    [0xb7, 0xb7],
    [0x300, 0x36f],
    [0x203f, 0x2040],
  ]);

function unicodeProperty(name: string): (character: string) => boolean {
  const block = name.startsWith("Is");
  const directory = block
    ? (blockAliases.get(normalize(name.slice(2))) ?? blocks.get(normalize(name.slice(2))))
    : categories[name];
  if (!directory) throw new Error(`Unknown Unicode property: ${name}`);
  const path = join(unicodeRoot, block ? "Block" : "General_Category", directory, "regex.js");
  let regex = propertyCache.get(path);
  if (!regex) {
    const supplied = require(path) as RegExp;
    // The pinned data encodes astral ranges as UTF-16 alternatives, not Unicode-mode classes.
    regex = new RegExp(`^(?:${supplied.source})$`, supplied.flags);
    propertyCache.set(path, regex);
  }
  return (character) => regex.test(character);
}

function freeSpacing(pattern: string): string {
  let result = "";
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index] ?? "";
    if (!depth && /[\t\n\r ]/u.test(character)) continue;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === "[" && (!depth || pattern[index - 1] === "-")) depth++;
    else if (character === "]") depth--;
    result += character;
  }
  return result;
}

function reference(pattern: string, start: number, groups: number) {
  let end = start;
  while (/^[0-9]$/u.test(pattern[end] ?? "")) end++;
  const digits = pattern.slice(start, end);
  let length = digits.length;
  while (length && Number(digits.slice(0, length)) > groups) length--;
  if (!length) throw new Error("Backreference must refer to an earlier capturing group.");
  return { group: Number(digits.slice(0, length)), next: start + length };
}

/** xspattern has no backrefs; validate their XPath numbering before substituting an atom. */
function parserBackReferences(pattern: string): string {
  let result = "";
  let depth = 0;
  let count = 0;
  const groups: number[] = [];
  const closed = new Set<number>();
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index] ?? "";
    if (character === "\\") {
      if (!depth && /^[1-9]$/u.test(pattern[index + 1] ?? "")) {
        const ref = reference(pattern, index + 1, count);
        if (!closed.has(ref.group)) throw new Error("Backreference cannot refer to an open group.");
        result += "x";
        index = ref.next - 1;
      } else {
        if (index + 1 === pattern.length) throw new Error("Trailing backslash.");
        result += character + pattern[++index];
      }
      continue;
    }
    if (character === "[") {
      if (depth && pattern[index - 1] !== "-")
        throw new Error("Nested classes require subtraction.");
      depth++;
    } else if (character === "]") {
      if (!depth) throw new Error("Unmatched closing bracket.");
      depth--;
    } else if (!depth && character === "(") {
      if (pattern[index + 1] === "?") throw new Error("XPath 2.0 only permits capturing groups.");
      groups.push(++count);
    } else if (!depth && character === ")") {
      const group = groups.pop();
      if (group === undefined) throw new Error("Unmatched closing parenthesis.");
      closed.add(group);
    }
    result += character;
  }
  if (depth || groups.length) throw new Error("Unterminated regular expression construct.");
  return result;
}

function compareDecimals(left: string, right: string): number {
  const a = left.replace(/^0+(?=\d)/u, "");
  const b = right.replace(/^0+(?=\d)/u, "");
  return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
}

/** Preserve the grammar without xspattern expanding huge counts into VM instructions. */
function parserQuantifiers(pattern: string): string {
  let result = "";
  let depth = 0;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index] ?? "";
    if (character === "\\") {
      result += character + pattern[++index];
      continue;
    }
    if (character === "[" && (!depth || pattern[index - 1] === "-")) depth++;
    else if (character === "]") depth--;
    if (!depth && character === "{") {
      const end = pattern.indexOf("}", index + 1);
      const count = /^(\d+)(?:,(\d*))?$/u.exec(pattern.slice(index + 1, end));
      if (end >= 0 && count) {
        const min = count[1] ?? "0";
        const max = count[2];
        if (max && compareDecimals(min, max) > 0) throw new Error("Reversed quantifier bounds.");
        result += max === undefined ? "{1}" : max === "" ? "{1,}" : "{1,1}";
        index = end;
        continue;
      }
    }
    result += character;
  }
  return result;
}

const caseMappings = new Map<string, Map<string, string>>();
function caseMapping(direction: "Lowercase" | "Uppercase"): Map<string, string> {
  let mapping = caseMappings.get(direction);
  if (!mapping) {
    mapping = new Map();
    for (const type of ["Simple_Case_Mapping", "Special_Casing"]) {
      const values = require(join(unicodeRoot, type, direction, "code-points.js")) as Map<
        number,
        number | number[]
      >;
      for (const [source, target] of values)
        mapping.set(
          String.fromCodePoint(source),
          String.fromCodePoint(...(Array.isArray(target) ? target : [target])),
        );
    }
    caseMappings.set(direction, mapping);
  }
  return mapping;
}
const caseValue = (character: string, direction: "Lowercase" | "Uppercase") =>
  caseMapping(direction).get(character) ?? character;
const sameCase = (a: string, b: string) =>
  a === b ||
  caseValue(a, "Lowercase") === caseValue(b, "Lowercase") ||
  caseValue(a, "Uppercase") === caseValue(b, "Uppercase");
let caseBuckets: Map<string, Set<string>> | undefined;

function variants(character: string): Set<string> {
  if (!caseBuckets) {
    const candidates = new Set<string>();
    for (const direction of ["Lowercase", "Uppercase"] as const)
      for (const [source, target] of caseMapping(direction)) {
        candidates.add(source);
        for (const character of target) candidates.add(character);
      }
    caseBuckets = new Map();
    for (const candidate of candidates) {
      for (const key of [
        "l:" + caseValue(candidate, "Lowercase"),
        "u:" + caseValue(candidate, "Uppercase"),
      ]) {
        const bucket = caseBuckets.get(key) ?? new Set<string>();
        bucket.add(candidate);
        caseBuckets.set(key, bucket);
      }
    }
  }
  return new Set([
    character,
    ...[caseValue(character, "Lowercase"), caseValue(character, "Uppercase")].filter(
      (value) => [...value].length === 1,
    ),
    ...(caseBuckets.get("l:" + caseValue(character, "Lowercase")) ?? []),
    ...(caseBuckets.get("u:" + caseValue(character, "Uppercase")) ?? []),
  ]);
}

interface Atom {
  test(character: string): boolean;
  scalar?: number;
  next: number;
}
const regexAtom = (source: string, next: number): Atom => {
  const regex = new RegExp("^(?:" + source + ")$", "v");
  return { test: (character) => regex.test(character), next };
};
function literalAtom(character: string, next: number, insensitive: boolean): Atom {
  return {
    scalar: character.codePointAt(0),
    next,
    test: insensitive ? (value) => sameCase(character, value) : (value) => value === character,
  };
}

function escapeAtom(pattern: string, start: number, insensitive: boolean): Atom {
  const escaped = pattern[start + 1] ?? "";
  const literals: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
  if (literals[escaped]) return literalAtom(literals[escaped] ?? "", start + 2, insensitive);
  if ("\\|.?*+{}()[]^$-".includes(escaped) && escaped)
    return literalAtom(escaped, start + 2, insensitive);
  if (escaped === "p" || escaped === "P") {
    const end = pattern.indexOf("}", start + 3);
    const property = pattern.slice(start + 3, end);
    const test = unicodeProperty(property);
    return { test: escaped === "P" ? (character) => !test(character) : test, next: end + 1 };
  }
  if (["d", "D", "w", "W"].includes(escaped)) {
    const properties = escaped.toLowerCase() === "d" ? ["Nd"] : ["L", "M", "N", "S"];
    const tests = properties.map(unicodeProperty);
    return {
      test: (character) =>
        tests.some((test) => test(character)) === (escaped === escaped.toLowerCase()),
      next: start + 2,
    };
  }
  const name = escaped.toLowerCase() === "i" ? nameStartClass : nameCharClass;
  const predefined: Record<string, string> = {
    s: "[\\x20\\x09\\x0d\\x0a]",
    S: "[^\\x20\\x09\\x0d\\x0a]",
    i: "[" + name + "]",
    I: "[^" + name + "]",
    c: "[" + name + "]",
    C: "[^" + name + "]",
  };
  const source = predefined[escaped];
  if (!source) throw new Error("escaped was not preflighted.");
  return regexAtom(source, start + 2);
}

function classAtom(pattern: string, start: number, insensitive: boolean): Atom {
  let index = start + 1;
  const negative = pattern[index] === "^";
  if (negative) index++;
  const terms: Atom[] = [];
  const union = (character: string) => terms.some((term) => term.test(character));
  const base = (character: string) => (negative ? !union(character) : union(character));
  const read = (): Atom => {
    if (pattern[index] === "\\") return escapeAtom(pattern, index, insensitive);
    const character = String.fromCodePoint(pattern.codePointAt(index) ?? 0);
    return literalAtom(character, index + character.length, insensitive);
  };
  while (index < pattern.length) {
    if (pattern[index] === "]") return { test: base, next: index + 1 };
    if (pattern[index] === "-" && pattern[index + 1] === "[") {
      const removed = classAtom(pattern, index + 1, insensitive);
      if (pattern[removed.next] !== "]") throw new Error("Subtraction was not preflighted.");
      return {
        test: (character) => base(character) && !removed.test(character),
        next: removed.next + 1,
      };
    }
    const first = read();
    index = first.next;
    if (
      first.scalar !== undefined &&
      pattern[index] === "-" &&
      !["[", "]"].includes(pattern[index + 1] ?? "")
    ) {
      index++;
      const last = read();
      index = last.next;
      const min = first.scalar;
      const max = last.scalar;
      if (max === undefined) throw new Error("Range was not preflighted.");
      const inside = (character: string) => {
        const value = character.codePointAt(0) ?? -1;
        return min <= value && value <= max;
      };
      terms.push({
        test: insensitive ? (character) => [...variants(character)].some(inside) : inside,
        next: index,
      });
    } else terms.push(first);
  }
  throw new Error("Class was not preflighted.");
}

type Expression =
  | { kind: "atom"; atom: Atom }
  | { kind: "anchor"; start: boolean }
  | { kind: "backref"; group: number }
  | { kind: "group"; group: number; child: Expression }
  | { kind: "repeat"; min: bigint; max: bigint | null; child: Expression }
  | { kind: "sequence"; children: Expression[] }
  | { kind: "choice"; children: Expression[] };

function expression(pattern: string, flags: string): Expression {
  let index = 0;
  let groups = 0;
  const insensitive = flags.includes("i");
  function alternatives(): Expression {
    const choices = [sequence()];
    while (pattern[index] === "|") {
      index++;
      choices.push(sequence());
    }
    return choices.length === 1
      ? (choices[0] as Expression)
      : { kind: "choice", children: choices };
  }
  function sequence(): Expression {
    const children: Expression[] = [];
    while (index < pattern.length && ![")", "|"].includes(pattern[index] ?? "")) {
      const character = pattern[index] ?? "";
      let child: Expression;
      if (character === "(") {
        index++;
        const group = ++groups;
        child = { kind: "group", group, child: alternatives() };
        index++;
      } else if (character === "^" || character === "$") {
        child = { kind: "anchor", start: character === "^" };
        index++;
      } else if (character === "\\" && /^[1-9]$/u.test(pattern[index + 1] ?? "")) {
        const ref = reference(pattern, index + 1, groups);
        child = { kind: "backref", group: ref.group };
        index = ref.next;
      } else {
        let atom: Atom;
        if (character === "[") atom = classAtom(pattern, index, insensitive);
        else if (character === "\\") atom = escapeAtom(pattern, index, insensitive);
        else if (character === ".")
          atom = { test: (value) => flags.includes("s") || value !== "\n", next: index + 1 };
        else {
          const value = String.fromCodePoint(pattern.codePointAt(index) ?? 0);
          atom = literalAtom(value, index + value.length, insensitive);
        }
        index = atom.next;
        child = { kind: "atom", atom };
      }
      const quantifier = pattern[index];
      if (quantifier && "?*+{".includes(quantifier)) {
        let min = quantifier === "+" ? 1n : 0n;
        let max: bigint | null = quantifier === "?" ? 1n : null;
        if (quantifier === "{") {
          const end = pattern.indexOf("}", index + 1);
          const [lower, upper] = pattern.slice(index + 1, end).split(",");
          min = BigInt(lower ?? "0");
          max = upper === undefined ? min : upper ? BigInt(upper) : null;
          index = end;
        }
        index++;
        if (pattern[index] === "?") index++;
        child = { kind: "repeat", min, max, child };
      }
      children.push(child);
    }
    return { kind: "sequence", children };
  }
  return alternatives();
}

interface MatchState {
  position: number;
  captures: Map<number, string[]>;
}
const stateKey = (state: MatchState) =>
  JSON.stringify([state.position, [...state.captures].sort(([a], [b]) => a - b)]);

/** Capture-aware matching is required: native /i changes properties and misses XPath case variants. */
function matches(tree: Expression, value: string, flags: string): boolean {
  const input = [...value];
  const insensitive = flags.includes("i");
  function* run(node: Expression, state: MatchState): Generator<MatchState> {
    if (node.kind === "atom") {
      const character = input[state.position];
      if (character !== undefined && node.atom.test(character))
        yield { ...state, position: state.position + 1 };
    } else if (node.kind === "anchor") {
      const position = state.position;
      const valid = node.start
        ? position === 0 ||
          (flags.includes("m") && position < input.length && input[position - 1] === "\n")
        : flags.includes("m")
          ? input[position] === "\n" || (position === input.length && input[position - 1] !== "\n")
          : position === input.length;
      if (valid) yield state;
    } else if (node.kind === "backref") {
      const captured = state.captures.get(node.group) ?? [];
      if (
        captured.every((character, offset) => {
          const actual = input[state.position + offset];
          return (
            actual !== undefined &&
            (insensitive ? sameCase(character, actual) : character === actual)
          );
        })
      )
        yield { ...state, position: state.position + captured.length };
    } else if (node.kind === "group") {
      for (const result of run(node.child, state)) {
        const captures = new Map(result.captures);
        captures.set(node.group, input.slice(state.position, result.position));
        yield { ...result, captures };
      }
    } else if (node.kind === "choice") {
      for (const child of node.children) yield* run(child, state);
    } else if (node.kind === "sequence") {
      let frontier = new Map([[stateKey(state), state]]);
      for (const child of node.children) {
        const next = new Map<string, MatchState>();
        for (const current of frontier.values())
          for (const result of run(child, current)) next.set(stateKey(result), result);
        frontier = next;
        if (!frontier.size) return;
      }
      yield* frontier.values();
    } else {
      type Counts = { min: bigint; max: bigint | null };
      const stack = [{ state, counts: { min: 0n, max: 0n } as Counts }];
      const seen = new Map<string, Counts[]>();
      while (stack.length) {
        const current = stack.pop();
        if (!current) continue;
        const signature = stateKey(current.state);
        const results = [...run(node.child, current.state)];
        let counts = current.counts;
        // A stable empty iteration permits every later count, including later consuming branches.
        if (results.some((result) => stateKey(result) === signature))
          counts = { ...counts, max: node.max };
        const previous = seen.get(signature) ?? [];
        if (
          previous.some(
            (range) =>
              range.min <= counts.min &&
              (range.max === null || (counts.max !== null && range.max >= counts.max)),
          )
        )
          continue;
        const separate: Counts[] = [];
        for (const range of previous) {
          if (
            (range.max !== null && range.max + 1n < counts.min) ||
            (counts.max !== null && counts.max + 1n < range.min)
          )
            separate.push(range);
          else {
            counts = {
              min: range.min < counts.min ? range.min : counts.min,
              max:
                range.max === null || counts.max === null
                  ? null
                  : range.max > counts.max
                    ? range.max
                    : counts.max,
            };
          }
        }
        seen.set(signature, [...separate, counts]);
        if (counts.max === null || counts.max >= node.min) yield current.state;
        if (node.max !== null && counts.min >= node.max) continue;
        const next: Counts = {
          min: counts.min + 1n,
          max: counts.max === null ? null : counts.max + 1n,
        };
        if (node.max !== null && (next.max === null || next.max > node.max)) next.max = node.max;
        for (const result of results) stack.push({ state: result, counts: next });
      }
    }
  }
  for (let position = 0; position <= input.length; position++)
    for (const _result of run(tree, { position, captures: new Map() })) return true;
  return false;
}

/** XPath 2.0 regex grammar and case semantics, with explicit XML/Unicode character classes. */
export function compileXPathPattern(pattern: string, flags = ""): (value: string) => boolean {
  if (!/^[imsx]*$/u.test(flags)) throw new Error("Pattern flags must use only i, m, s and x.");
  const source = flags.includes("x") ? freeSpacing(pattern) : pattern;
  compileXmlSchemaPattern(parserQuantifiers(parserBackReferences(source)), { language: "xpath" });
  const tree = expression(source, flags);
  return (value) => matches(tree, value, flags);
}
