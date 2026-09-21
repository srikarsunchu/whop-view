// `wv store`: the for-sale rule, the plan grouping, and the price and publish plans.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrice, buildPublish, forSale, parsePriceArgs, parsePublishArgs, plansOf, priceOf, storeData } from "../src/views/store.ts";
import { envelope, synthPage } from "./render.ts";

const rec = (name: string) => {
  const p = envelope(name);
  return p.ok && "record" in p.payload ? p.payload.record : {};
};
const list = (name: string) => {
  const p = envelope(name);
  return p.ok && p.payload.kind === "page" ? p.payload.rows : [];
};

test("store: prices read as numbers or money objects; plans group under their product; for sale needs a visible product and a visible buy-now plan", () => {
  assert.equal(priceOf(10), 10);
  assert.equal(priceOf({ currency: "usd", amount: "29.00" }), 29);
  assert.equal(priceOf(null), undefined);
  const plans = list("plans.list");
  const own = plansOf(plans, "prod_iQ2Zub6GFQS5Q");
  assert.equal(own.length, 2, "the third recorded plan belongs to the other product");
  const products = list("products.list");
  const hyper = products.find((p) => p.id === "prod_iQ2Zub6GFQS5Q")!;
  assert.deepEqual(forSale(hyper, own), { ok: true });
  assert.match(forSale({ ...hyper, visibility: "hidden" }, own).why ?? "", /not for sale until published/);
  assert.match(forSale(hyper, []).why ?? "", /no plan/);
  assert.match(forSale(hyper, own.map((p) => ({ ...p, visibility: "hidden" }))).why ?? "", /Every plan is hidden/);
  const d = storeData({ products: envelope("products.list"), plans: envelope("plans.list"), promoCodes: envelope("promo-codes.list"), checkouts: synthPage([]), commands: [] }) as { ok: boolean; products: { id: string; forSale: { ok: boolean }; plans: unknown[] }[] };
  assert.equal(d.ok, true);
  assert.equal(d.products.find((p) => p.id === "prod_iQ2Zub6GFQS5Q")?.plans.length, 2);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
});

test("store price: the plan first; the change reads before → after; same price, sub-dollar, and archived are stops", () => {
  const { opts } = parsePriceArgs(["store", "price", "plan_NrjXyj6yTetff", "--to", "39", "--idempotency-key", "k"]);
  assert.match(parsePriceArgs(["store", "price", "plan_1"]).error ?? "", /What to/);
  assert.match(parsePriceArgs(["store", "price"]).error ?? "", /Which plan/);
  assert.match(parsePriceArgs(["store", "price", "plan_1", "--to", "x"]).error ?? "", /--to needs/);
  const plan = buildPrice(["store", "price"], opts!, { plan: rec("plans.get"), accountId: "biz_1" });
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.steps[0].argv, ["plans", "update", "plan_NrjXyj6yTetff", "--initial_price", "39", "--idempotency-key", "k-price"], "a one-time plan changes its initial price");
  assert.match(plan.steps[0].what, /\$10\.00 → \$39\.00/);
  assert.match(plan.warnings[0], /2 members have bought this plan at the old price/);
  const renewal = buildPrice(["store", "price"], { ...opts!, initial: 0 }, { plan: { ...rec("plans.get"), plan_type: "renewal", renewal_price: 29, initial_price: 29, billing_period: 30, member_count: 5 } });
  assert.ok(renewal.steps[0].argv.includes("--renewal_price") && renewal.steps[0].argv.includes("--initial_price"));
  assert.match(renewal.warnings[0], /does not say whether a renewal price change applies/);
  assert.match(buildPrice(["store", "price"], { ...opts!, to: 10 }, { plan: rec("plans.get") }).blockers[0], /already \$10\.00/);
  assert.match(buildPrice(["store", "price"], { ...opts!, to: 0.5 }, { plan: rec("plans.get") }).blockers[0], /at least \$1\.00/);
  assert.match(buildPrice(["store", "price"], { ...opts!, initial: 5 }, { plan: rec("plans.get") }).blockers[0], /--initial is for subscriptions/);
  assert.match(buildPrice(["store", "price"], opts!, { plan: { ...rec("plans.get"), visibility: "archived" } }).blockers[0], /archived/);
  assert.match(buildPrice(["store", "price"], opts!, { planError: "Resource not found" }).blockers[0], /could not be read/);
});

test("store publish: publish then a checkout link for the default plan; nothing to buy is a stop; already visible skips the publish", () => {
  const { opts } = parsePublishArgs(["store", "publish", "prod_iQ2Zub6GFQS5Q", "--idempotency-key", "k"]);
  assert.match(parsePublishArgs(["store", "publish"]).error ?? "", /Which product/);
  assert.equal(parsePublishArgs(["store", "publish", "prod_1", "--no-link"]).opts?.link, false);
  const plans = list("plans.list");
  const visible = buildPublish(["store", "publish"], opts!, { product: rec("products.get"), plans, accountId: "biz_1" });
  assert.deepEqual(visible.blockers, []);
  assert.equal(visible.steps[0].skipped, "already visible");
  assert.equal(visible.steps[1].skipped, undefined);
  assert.ok(visible.steps[1].argv.includes("plan_ozEZmitgc8tjB"), "the product's default plan gets the link");
  const hidden = buildPublish(["store", "publish"], opts!, { product: { ...rec("products.get"), visibility: "hidden" }, plans });
  assert.equal(hidden.steps[0].skipped, undefined);
  assert.deepEqual(hidden.steps.map((s) => s.key), ["publish", "link"]);
  const bare = buildPublish(["store", "publish"], opts!, { product: { ...rec("products.get"), visibility: "hidden", headline: null, description: null }, plans: [] });
  assert.match(bare.blockers[0], /no plan/);
  assert.match(bare.warnings[0], /no headline and no description/);
  const allHidden = buildPublish(["store", "publish"], opts!, { product: rec("products.get"), plans: plans.map((p) => ({ ...p, visibility: "hidden" })) });
  assert.match(allHidden.blockers[0], /Every plan is hidden/);
  const noLink = buildPublish(["store", "publish"], { ...opts!, link: false }, { product: { ...rec("products.get"), visibility: "hidden" }, plans });
  assert.equal(noLink.steps[1].skipped, "--no-link");
});
