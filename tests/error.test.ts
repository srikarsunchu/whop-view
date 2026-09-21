// Feature gates: which message maps to which unlock, from the recorded errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorView, gateFor } from "../src/views/error.ts";
import { strip } from "../src/ansi.ts";
import { envelope, theme } from "./render.ts";

const message = (name: string) => {
  const p = envelope(name);
  if (p.ok) throw new Error(`${name} is not an error`);
  return p.error;
};

test("gates: Economic Intelligence is a preference with a command, experiments are internal, cards need a Rain account", () => {
  const ei = gateFor(message("error.gated").message);
  assert.deepEqual(ei?.fix, ["whop", "accounts", "update-preferences", "--economic_intelligence", "true"]);
  const exp = gateFor(message("error.experiments").message);
  assert.equal(exp?.fix, undefined);
  assert.match(exp?.note ?? "", /Whop-internal only/);
  const cards = gateFor(message("error.cards").message);
  assert.equal(cards?.fix?.[1], "verifications");
  assert.equal(gateFor("You don't have access to Financing yet.")?.note.startsWith("Whop turns this on per business"), true);
  assert.equal(gateFor(message("error.cashback").message), undefined, "an account-scoped credential is a login problem, not a gate");
  assert.equal(gateFor("Membership not found"), undefined);
});

test("gates: the band carries the message, the note, and the fix; the credential error carries the login fix", () => {
  const band = strip(errorView(message("error.gated"), theme(80, false)).join("\n"));
  assert.match(band, /Not available on this business yet/);
  assert.match(band, /A preference on the business turns it on/);
  assert.match(band, /fix  whop accounts update-preferences --economic_intelligence true/);
  const internal = strip(errorView(message("error.experiments"), theme(80, false)).join("\n"));
  assert.match(internal, /No plan or preference unlocks it outside Whop/);
  assert.doesNotMatch(internal, /fix  /);
  const login = strip(errorView(message("error.cashback"), theme(80, false)).join("\n"));
  assert.match(login, /Missing permission/);
  assert.match(login, /fix  whop login --api-key/);
});
