// Application notes: thread ops merge, never overwrite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyThread, mergePatch, patchRow, threadText } from "../app/js/model.js";

const E = (id, at, text = id) => ({ id, at, text });

test("queued posts accumulate instead of the last one winning", () => {
  const p = mergePatch(mergePatch({}, { threadAdd: [E("a", "2026-10-01T10:00:00Z")] }),
    { threadAdd: [E("b", "2026-10-01T11:00:00Z")], status: "Applied" });
  assert.deepEqual(p.threadAdd.map(e => e.id), ["a", "b"]);
  assert.equal(p.status, "Applied");
});

test("patchRow applies adds and removes, oldest first", () => {
  const row = { id: "l", thread: [E("x", "2026-09-30T10:00:00Z")] };
  const out = patchRow(row, { threadAdd: [E("z", "2026-10-02T00:00:00Z"), E("y", "2026-10-01T00:00:00Z")], threadRemove: ["x"], notes: "n" });
  assert.deepEqual(out.thread.map(e => e.id), ["y", "z"]);
  assert.equal(out.notes, "n");
  assert.equal(patchRow(row, { notes: "n" }).thread, row.thread, "untouched without thread ops");
});

test("a removed entry stays removed even if re-added in the same patch", () => {
  assert.deepEqual(applyThread([], [E("a", "2026-10-01T00:00:00Z")], ["a"]), []);
});

test("threadText lists newest first", () => {
  const t = threadText([E("a", "2026-09-30T14:00:00Z", "first"), E("b", "2026-10-01T14:00:00Z", "second")]);
  assert.ok(t.indexOf("second") < t.indexOf("first"));
  assert.match(t, /Oct 1, 2026/);
});
