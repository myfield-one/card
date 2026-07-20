import assert from "node:assert/strict";
import test from "node:test";

import { checkpointHeadAfterRemoteApply } from "../src/sync/model.ts";

test("remote index checkpoint keeps retry head when payloads were skipped", () => {
  assert.equal(checkpointHeadAfterRemoteApply("remote-v2", "remote-v1", true), "remote-v1");
  assert.equal(checkpointHeadAfterRemoteApply("remote-v2", null, true), null);
});

test("remote index checkpoint advances when all payloads were applied", () => {
  assert.equal(checkpointHeadAfterRemoteApply("remote-v2", "remote-v1", false), "remote-v2");
});
