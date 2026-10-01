// Ranking (#1, #2…): the pure reorder used by the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rerank, rankable } from "../app/js/model.js";

const L = (id, rank = null) => ({ id, rank });
const apply = (list, patches) => {
  const m = new Map(list.map(l => [l.id, l.rank]));
  for (const p of patches) m.set(p.id, p.rank);
  return [...m].filter(([, r]) => r != null).sort((a, b) => a[1] - b[1]).map(([id]) => id);
};

test("ranking an unranked listing inserts it and shifts the rest down", () => {
  const list = [L("a", 1), L("b", 2), L("c", 3), L("x")];
  const p = rerank(list, "x", 2);
  assert.deepEqual(apply(list, p), ["a", "x", "b", "c"]);
  assert.deepEqual(p.sort((m, n) => m.id.localeCompare(n.id)), [{ id: "b", rank: 3 }, { id: "c", rank: 4 }, { id: "x", rank: 2 }]);
});

test("moving up or down only renumbers what moved", () => {
  const list = [L("a", 1), L("b", 2), L("c", 3), L("d", 4)];
  assert.deepEqual(apply(list, rerank(list, "d", 1)), ["d", "a", "b", "c"]);
  assert.deepEqual(apply(list, rerank(list, "a", 3)), ["b", "c", "a", "d"]);
  assert.deepEqual(rerank(list, "b", 2), [], "same rank: nothing to write");
});

test("unranking closes the gap", () => {
  const list = [L("a", 1), L("b", 2), L("c", 3)];
  const p = rerank(list, "a", null);
  assert.deepEqual(apply(list, p), ["b", "c"]);
  assert.ok(p.some(x => x.id === "a" && x.rank === null));
});

test("out-of-range ranks clamp; gaps and ties in old data get repaired", () => {
  const list = [L("a", 1), L("b", 1), L("c", 7)];
  assert.deepEqual(apply(list, rerank(list, "c", 99)), ["a", "b", "c"]);
  assert.deepEqual(apply(list, rerank(list, "c", 0)), ["c", "a", "b"]);
});

test("only shortlist and in-progress groups are rankable", () => {
  assert.equal(rankable("shortlist"), true);
  assert.equal(rankable("active"), true);
  for (const g of ["review", "done", "archived"]) assert.equal(rankable(g), false);
});
