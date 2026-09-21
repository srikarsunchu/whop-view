#!/bin/sh
# A stand-in whop for tests and skill evals: echoes argv to stderr (and to $WV_FAKE_LOG when set), answers the
# reads the gate needs from tests/fixtures, and answers writes with ids. WV_FAKE_READY adds a page and a payment
# method; WV_FAKE_PAGED pages products list; WV_FAKE_METHODS swaps the payout methods fixture; WV_FAKE_CAMPAIGN_FAILS
# fails the campaign create; WV_FAKE_QUIET drops the stderr echo for demo recordings. Used by tests/passthrough.test.ts and scripts/eval-skill.ts.
[ -n "$WV_FAKE_LOG" ] && echo "$*" >> "$WV_FAKE_LOG"
if [ -z "$WV_FAKE_QUIET" ]; then
  echo "ARGS: $*" >&2
  echo "BASE: ${WHOP_API_BASE_URL:-unset} KEY: ${WHOP_API_KEY:-unset}" >&2
fi
fx() { cat "${WV_FAKE_FIXTURES}/$1"; exit 0; }
# `auth switch <profile>` is remembered in a file beside the log; an api-key profile makes the account "ready" for webhooks.
[ -n "$WV_FAKE_LOG" ] && [ -f "$WV_FAKE_LOG.profile" ] && [ "$(cat "$WV_FAKE_LOG.profile")" = "sandbox" ] && WV_FAKE_READY=1
if [ "$1" = "--llms-full" ]; then
  printf '# whop\n\n## whop products\n\n### whop products frobnicate\n\nFrobnicate Product\n\n> Confirm with the user before executing this destructive command.\n\n### whop products list\n\nList Products\n'
  exit 0
fi
case "$*" in *--schema*) [ -f "${WV_FAKE_FIXTURES}/schema.$1.$2.json" ] && fx "schema.$1.$2.json"; echo '{"code":"COMMAND_NOT_FOUND","message":"no schema"}'; exit 1 ;; esac
case "$1 $2" in
  "products list")
    case "$*" in
      *--after*c2*) fx products.list.json ;;
      *--format*json*--full-output*) [ -n "$WV_FAKE_PAGED" ] && fx products.list.page1.json; fx products.list.json ;;
      *) fx products.list.plain.txt ;;
    esac ;;
  "products get") fx products.get.json ;;
  "auth status") fx auth.status.json ;;
  "auth switch") [ -n "$WV_FAKE_LOG" ] && echo "$3" > "$WV_FAKE_LOG.profile"; echo '{"ok":true,"data":{"active":"'"$3"'"},"meta":{"command":"auth switch","duration":"1ms"}}'; exit 0 ;;
  "people list") fx people.list.json ;;
  "payouts list") fx payouts.list.json ;;
  "apps list") fx apps.list.json ;;
  "plans list") fx plans.list.json ;;
  "plans get") sed "s/plan_NrjXyj6yTetff/${3:-plan_NrjXyj6yTetff}/" "${WV_FAKE_FIXTURES}/plans.get.json"; exit 0 ;;
  "plans update") echo '{"ok":true,"data":{"id":"'"$3"'","title":"Flex — 300 credits","initial_price":39,"renewal_price":0,"plan_type":"one_time"},"meta":{"command":"plans update","duration":"1ms"}}'; exit 0 ;;
  "products publish") echo '{"ok":true,"data":{"id":"'"$3"'","title":"Hypermotion","visibility":"visible"},"meta":{"command":"products publish","duration":"1ms"}}'; exit 0 ;;
  "promo-codes list") fx promo-codes.list.json ;;
  "checkout-configurations list") echo '{"ok":true,"data":{"data":[],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"checkout-configurations list","duration":"1ms"}}'; exit 0 ;;
  "apps logs") fx apps.logs.json ;;
  "auth list") [ -n "$WV_FAKE_READY" ] && { echo '{"ok":true,"data":{"active":"sandbox","profiles":[{"name":"sandbox","method":"api_key","accountId":"biz_VraUMckluH8dzV","accountTitle":"Hypermotion"},{"name":"sunchusrikar","method":"oauth","accountId":"biz_VraUMckluH8dzV","accountTitle":"Frame"}]},"meta":{"command":"auth list","duration":"1ms"}}'; exit 0; }; fx auth.list.json ;;
  "permissions check") [ -n "$WV_FAKE_READY" ] && { echo '{"ok":true,"data":{"data":[{"action":"developer:manage_webhook","granted":true}]},"meta":{"command":"permissions check","duration":"1ms"}}'; exit 0; }; fx permissions.check.json ;;
  "app-builds list") echo '{"ok":true,"data":{"data":[{"id":"apbd_1","platform":"web","status":"approved","is_production":true,"created_at":"2026-09-19T10:00:00Z"},{"id":"apbd_2","platform":"web","status":"pending","is_production":false,"created_at":"2026-09-21T09:00:00Z"}],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"app-builds list","duration":"1ms"}}'; exit 0 ;;
  "domains list") echo '{"ok":true,"data":{"data":[{"id":"dom_1","domain":"app.hypermotion.art","status":"active","dns_status":"verified","certificate_status":"active","last_checked_at":"2026-09-21T11:00:00Z"}],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"domains list","duration":"1ms"}}'; exit 0 ;;
  "webhooks list") [ -n "$WV_FAKE_READY" ] && { echo '{"ok":true,"data":{"data":[{"id":"hook_1","url":"https://hypermotion.art/hooks","enabled":true,"events":["payment.succeeded"],"consecutive_failures":0}],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"webhooks list","duration":"1ms"}}'; exit 0; }; fx error.webhooks_oauth.json ;;
  "webhooks create") echo '{"ok":true,"data":{"id":"hook_2","url":"https://example.com/hooks","enabled":true,"events":["payment.succeeded"]},"meta":{"command":"webhooks create","duration":"1ms"}}'; exit 0 ;;
  "webhooks test") echo '{"ok":true,"data":{"status":200,"body":"OK","success":true},"meta":{"command":"webhooks test","duration":"1ms"}}'; exit 0 ;;
  "webhooks deliveries") echo '{"ok":true,"data":{"data":[{"id":"whd_1","event":"payment.succeeded","success":true,"response_code":200,"sent_at":"2026-09-21T12:00:00Z"}],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"webhooks deliveries","duration":"1ms"}}'; exit 0 ;;
  "payments list") fx payments.list.json ;;
  "payments get") sed "s/pay_JFHAhioMdPL1ts/${3:-pay_JFHAhioMdPL1ts}/" "${WV_FAKE_FIXTURES}/payments.get.json"; exit 0 ;;
  "files create") echo '{"ok":true,"data":{"id":"file_new1","filename":"evidence.pdf","visibility":"private"},"meta":{"command":"files create","duration":"1ms"}}'; exit 0 ;;
  "memberships list") fx memberships.list.json ;;
  "memberships get") fx memberships.get.json ;;
  "members list") fx members.list.json ;;
  "disputes list") fx disputes.list.json ;;
  "disputes get") [ -n "$WV_FAKE_LOG" ] && [ -f "$WV_FAKE_LOG.submitted" ] && { sed 's/"needs_response"/"under_review"/; s/"evidence_editable": true/"evidence_editable": false/; s/"evidence_locked_reason": null/"evidence_locked_reason": "submitted"/; s/"evidence_submitted_at": null/"evidence_submitted_at": "2026-09-21T12:30:00Z"/' "${WV_FAKE_FIXTURES}/disputes.get.json"; exit 0; }; [ -n "$WV_FAKE_DISPUTE_LOCKED" ] && { sed 's/"needs_response"/"under_review"/; s/"evidence_editable": true/"evidence_editable": false/; s/"evidence_locked_reason": null/"evidence_locked_reason": "submitted"/' "${WV_FAKE_FIXTURES}/disputes.get.json"; exit 0; }; fx disputes.get.json ;;
  "resolution-center-cases list") echo '{"ok":true,"data":{"data":[],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"resolution-center-cases list","duration":"1ms"}}'; exit 0 ;;
  "payments refund") echo '{"ok":true,"data":{"id":"pay_JFHAhioMdPL1ts","status":"paid","refunded_amount":{"currency":"usd","amount":"10.00"}},"meta":{"command":"payments refund","duration":"1ms"}}'; exit 0 ;;
  "disputes upload_evidence") echo '{"ok":true,"data":{"id":"dsp_x1","status":"needs_response","evidence":{"documents":[{"id":"file_a","document_type":"digital_fulfillment"}]}},"meta":{"command":"disputes upload_evidence","duration":"1ms"}}'; exit 0 ;;
  "disputes submit") [ -n "$WV_FAKE_LOG" ] && touch "$WV_FAKE_LOG.submitted"; echo '{"ok":true,"data":{"id":"dsp_x1","status":"under_review","evidence_submitted_at":"2026-09-21T12:30:00Z"},"meta":{"command":"disputes submit","duration":"1ms"}}'; exit 0 ;;
  "accounts reserves") fx accounts.reserves.json ;;
  "verifications list") fx verifications.list.json ;;
  "exports create") echo '{"ok":true,"data":{"id":"exp_1","resource":"financial-activity","status":"pending","progress_percent":0},"meta":{"command":"exports create","duration":"1ms"}}'; exit 0 ;;
  "ledgers report") fx ledgers.report.json ;;
  "payouts methods") fx "${WV_FAKE_METHODS:-payouts.methods.limits.json}" ;;
  "accounts preferences") [ -n "$WV_FAKE_READY" ] && { echo '{"ok":true,"data":{"ads_payment_methods":[{"id":"pm_1","brand":"visa","last4":"4242"}],"ads_reporting_currency":"usd","economic_intelligence":true},"meta":{"command":"accounts preferences","duration":"1ms"}}'; exit 0; }; fx accounts.preferences.json ;;
  "social-accounts list") [ -n "$WV_FAKE_READY" ] && { echo '{"ok":true,"data":{"data":[{"id":"sacc_1","platform":"facebook","name":"Hypermotion","username":"hypermotion"}],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"social-accounts list","duration":"1ms"}}'; exit 0; }; fx social-accounts.list.json ;;
  "audiences create") case "$*" in *customers*) echo '{"ok":true,"data":{"id":"adaud_customers","name":"customers","status":"pending"},"meta":{"command":"audiences create","duration":"1ms"}}' ;; *) echo '{"ok":true,"data":{"id":"adaud_visitors","name":"visited 30d, no purchase","status":"pending"},"meta":{"command":"audiences create","duration":"1ms"}}' ;; esac; exit 0 ;;
  "ad-groups create") echo '{"ok":true,"data":{"id":"adgrp_1","title":"winback 30d","status":"active"},"meta":{"command":"ad-groups create","duration":"1ms"}}'; exit 0 ;;
  "ad-campaigns get") echo '{"ok":true,"data":{"id":"adcamp_1","title":"Launch · Hypermotion","status":"active","delivery_status":"active"},"meta":{"command":"ad-campaigns get","duration":"1ms"}}'; exit 0 ;;
  "ad-groups list") echo '{"ok":true,"data":{"data":[{"id":"adgrp_a","title":"US 25-44","status":"active","delivery_status":"active","spend":420,"results":60,"cost_per_result":7,"return_on_ad_spend":3.1,"created_at":"2026-09-10T00:00:00Z"},{"id":"adgrp_b","title":"lal 1%","status":"active","delivery_status":"learning","spend":90,"results":4,"cost_per_result":22.5,"created_at":"2026-09-20T00:00:00Z"},{"id":"adgrp_c","title":"lal 3%","status":"active","delivery_status":"active","spend":600,"results":55,"cost_per_result":18.5,"return_on_ad_spend":0.4,"created_at":"2026-09-05T00:00:00Z"},{"id":"adgrp_d","title":"broad","status":"active","delivery_status":"active","spend":0,"results":0,"created_at":"2026-09-19T00:00:00Z"}],"page_info":{"start_cursor":null,"end_cursor":null,"has_next_page":false,"has_previous_page":false}},"meta":{"command":"ad-groups list","duration":"1ms"}}'; exit 0 ;;
  "promo-codes create") echo '{"ok":true,"data":{"id":"promo_1","code":"LAUNCH20","status":"active"},"meta":{"command":"promo-codes create","duration":"1ms"}}'; exit 0 ;;
  "checkout-configurations create") echo '{"ok":true,"data":{"id":"chk_1","purchase_url":"https://whop.com/checkout/chk_1"},"meta":{"command":"checkout-configurations create","duration":"1ms"}}'; exit 0 ;;
  "ad-campaigns create") [ -n "$WV_FAKE_CAMPAIGN_FAILS" ] && { echo '{"ok":false,"error":{"code":"HTTP_422","message":"No ads payment method"},"meta":{"command":"ad-campaigns create","duration":"1ms"}}'; exit 1; }; echo '{"ok":true,"data":{"id":"adcamp_1","status":"paused"},"meta":{"command":"ad-campaigns create","duration":"1ms"}}'; exit 0 ;;
  "ads create") echo '{"ok":true,"data":{"id":"ad_1","status":"in_review"},"meta":{"command":"ads create","duration":"1ms"}}'; exit 0 ;;
  "ad-groups estimate_reach") echo '{"ok":false,"error":{"code":"HTTP_400","message":"no estimate"},"meta":{"command":"ad-groups estimate_reach","duration":"1ms"}}'; exit 1 ;;
  "payouts create"|"products update"|"products frobnicate") echo '{"ok":true,"data":{"id":"fake_1"},"meta":{"command":"'"$1 $2"'","duration":"1ms"}}'; exit 0 ;;
esac
echo '{"code":"COMMAND_NOT_FOUND","message":"nope"}'
exit 1
