import assert from "node:assert/strict";
import test from "node:test";
import { compileXPathPattern } from "../src/shacl-regex.ts";

test("XPath patterns preserve XML classes, code points, and case variants", () => {
  const cases: [string, string, string, boolean][] = [
    ["^\\i\\c*$", "", "é-name9", true],
    ["^\\I+$", "", "123", true],
    ["^[a-z-[aeiou]]+$", "i", "BCDF", true],
    ["^[a-z-[aeiou]]+$", "i", "A", false],
    ["^[^a-z]$", "i", "ſ", false],
    ["^\\p{Lu}$", "i", "a", false],
    ["^[\\p{Lu}a]$", "i", "b", false],
    ["^\\p{IsPrivateUse}$", "", "\ue000", true],
    ["^\\p{IsGreek}$", "", "Ω", true],
    ["^\\p{IsEmoticons}$", "", "😀", true],
    ["^\\P{IsEmoticons}$", "", "A", true],
    ["^\\P{IsEmoticons}$", "", "😀", false],
    ["^\\p{IsDeseret}$", "", "𐐀", true],
    ["^\\p{Lu}$", "", "𐐀", true],
    ["^𐐀$", "i", "𐐨", true],
    ["^\\p{Cn}$", "", "\u{10d50}", true],
    ["^\\p{Lu}$", "", "\u{10d50}", false],
    ["^\\p{IsCombiningMarksforSymbols}$", "", "\u20d0", true],
    ["^.$", "", "😀", true],
    ["^.$", "", "\r", true],
    ["^.$", "", "\n", false],
    ["^.$", "s", "\n", true],
    ["^I$", "i", "ı", true],
    ["^ſ$", "i", "s", true],
    ["^\ufb05$", "i", "\ufb06", true],
    ["^[\ufb05-\ufb05]$", "i", "\ufb06", true],
    ["^İ$", "i", "i", false],
    ["^ß$", "i", "ss", false],
  ];
  for (const [pattern, flags, value, expected] of cases)
    assert.equal(
      compileXPathPattern(pattern, flags)(value),
      expected,
      JSON.stringify({ pattern, flags, value }),
    );
});

test("XPath flags and backreferences obey XPath 2.0 semantics", () => {
  const cases: [string, string, string, boolean][] = [
    ["a", "", "cat", true],
    ["^a$", "", "a\n", false],
    ["^b$", "m", "a\nb\nc", true],
    ["^b$", "m", "a\rb\rc", false],
    ["\\n^$", "m", "\n", false],
    ["\\n$", "m", "\n", false],
    ["^a\\ sb$", "x", "a\tb", true],
    ["^a[ ]b$", "x", "a b", true],
    ["^a # b$", "x", "a#b", true],
    ["^(I)\\1$", "i", "Iı", true],
    ["^(a)\\12$", "", "aa2", true],
    ["^(a)?\\1$", "", "", true],
    ["^((a)|(b))+\\2$", "", "aba", true],
    ["^a+?$", "", "aaa", true],
    ["^(){1000000000}$", "", "", true],
    ["^a{1000000000}$", "", "a", false],
    ["^(a?){1000000000}$", "", "a", true],
    ["(^|(a)){3}\\2$", "", "aa", true],
    ["(^|(a)){1000000000}\\2$", "", "aa", true],
    ["^(a){3}$", "", "aa", false],
  ];
  for (const [pattern, flags, value, expected] of cases)
    assert.equal(
      compileXPathPattern(pattern, flags)(value),
      expected,
      JSON.stringify({ pattern, flags, value }),
    );
});

test("XPath patterns reject invalid syntax and JavaScript or later-XPath extensions", () => {
  for (const pattern of [
    "\\1",
    "(a\\1)",
    "(?:a)",
    "(?=a)",
    "a{2,1}",
    "[z-a]",
    "[a[b]]",
    "\\p{IsUnknownBlock}",
    "\\ ",
    "[]",
    "\\0",
    "a**",
  ])
    assert.throws(() => compileXPathPattern(pattern), pattern);
  assert.throws(() => compileXPathPattern("a\\ ", "x"));
  for (const flags of ["q", "u", "g"]) assert.throws(() => compileXPathPattern("a", flags));
});
