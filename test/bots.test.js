import { test } from "node:test";
import assert from "node:assert/strict";
import { config, isAllowedBot } from "../src/config.js";

test("only allowed bots get answered", () => {
  assert.equal(isAllowedBot({ bot: true, id: "1", username: "Rook" }), true);
  assert.equal(isAllowedBot({ bot: true, id: "2", username: "rook" }), true);
  assert.equal(isAllowedBot({ bot: true, id: "3", username: "SomeOtherBot" }), false);
  assert.equal(isAllowedBot({ bot: false, id: "4", username: "Rook" }), false); // a person named Rook is just a person
  config.allowedBotIds = ["999"];
  assert.equal(isAllowedBot({ bot: true, id: "999", username: "Renamed" }), true);
});
