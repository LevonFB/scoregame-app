// Stage 1 E2E — generate a VALID Telegram WebApp initData string for a TEST user,
// signed with a TEST bot token. This mirrors verifyInitData() in src/index.ts:
//   secret = HMAC_SHA256(key="WebAppData", msg=botToken)
//   hash   = HMAC_SHA256(key=secret,       msg=dataCheckString)
//   dataCheckString = sorted "k=v" (decoded values) joined by "\n", excluding hash
//
// SAFETY: this helper lives only under e2e/ and is never imported by the worker
// runtime, so it cannot become a production auth bypass. It needs the test bot
// token to produce a matching signature — it grants no special privilege.

import crypto from "node:crypto";

export function buildInitData(user, botToken, opts = {}) {
  const authDate = opts.authDate ?? Math.floor(Date.now() / 1000);
  const fields = {
    auth_date: String(authDate),
    user: JSON.stringify(user),
  };
  if (opts.queryId) fields.query_id = opts.queryId;
  // Deep-link payload (referral/attribution tests) — signed like any other field.
  if (opts.startParam) fields.start_param = opts.startParam;

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  // Worker decodes via URLSearchParams, so URL-encode here.
  return new URLSearchParams({ ...fields, hash }).toString();
}
