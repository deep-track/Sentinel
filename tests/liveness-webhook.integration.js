const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function twilioSign(url, params, authToken) {
  const canonical = url + Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + value).join("");
  return crypto.createHmac("sha1", authToken).update(canonical).digest("base64");
}
function mockTwilioRequest(url, params, authToken, signature = twilioSign(url, params, authToken)) {
  return { url, body: new URLSearchParams(params).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature } };
}
test("accepts a valid standard Twilio form-encoded delivery payload", () => {
  const http = read("backend/convex/http.ts");
  const request = mockTwilioRequest("https://example.convex.site/webhooks/liveness/delivery", { MessageSid: "SM_mock_123", MessageStatus: "delivered", To: "+254700000000" }, "local-auth-token");
  assert.match(request.body, /MessageSid=SM_mock_123/);
  assert.match(http, /new URLSearchParams\(rawBody\)/);
  assert.match(http, /X-Twilio-Signature/);
  assert.match(http, /verifyTwilioSignature\(request.url, params, signature, authToken\)/);
  assert.match(http, /applyDeliveryCallback/);
});
test("rejects a tampered or missing Twilio signature", () => {
  const http = read("backend/convex/http.ts");
  assert.match(http, /if \(!authToken \|\| !\(await verifyTwilioSignature/);
  const valid = twilioSign("https://example.test/webhooks/liveness/delivery", { MessageSid: "SM1", MessageStatus: "sent" }, "token");
  assert.notEqual(valid, twilioSign("https://example.test/webhooks/liveness/delivery", { MessageSid: "SM1", MessageStatus: "failed" }, "token"));
});
test("maps Twilio delivery statuses without completing liveness prematurely", () => {
  const http = read("backend/convex/http.ts");
  const liveness = read("backend/convex/liveness.ts");
  assert.match(http, /mapTwilioDeliveryStatus\(params.get\("MessageStatus"\)\)/);
  assert.match(liveness, /export const applyDeliveryCallback/);
  assert.match(liveness, /deliveryStatus/);
  assert.match(liveness, /export const applyCallback/);
  assert.match(liveness, /if \(row\.status !== "pending"\) return \{ accepted: true, duplicate: true \}/);
});
test("handles malformed and unknown provider callbacks safely", () => {
  const http = read("backend/convex/http.ts");
  const liveness = read("backend/convex/liveness.ts");
  assert.match(http, /if \(!providerMessageId\) return json\(\{ error: "Missing MessageSid" \}, 400\)/);
  assert.match(http, /return json\(result, result\.accepted \? 200 : 404\)/);
  assert.match(liveness, /by_provider_message/);
});
