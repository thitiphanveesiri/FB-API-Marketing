import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, toCsv } from "./csv";

test("CSV neutralizes formula-leading text without changing numbers", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("  +SUM(A1:A2)"), "'  +SUM(A1:A2)");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("\tvalue"), "'\tvalue");
  assert.equal(csvCell(-2), "-2");
  assert.equal(csvCell(false), "false");
});

test("CSV quotes quotes, commas and line breaks after neutralization", () => {
  assert.equal(csvCell('say "hello", then\nleave'), '"say ""hello"", then\nleave"');
  assert.equal(toCsv([["name", "value"], ["=1+1", 2]]), "name,value\r\n'=1+1,2");
});
