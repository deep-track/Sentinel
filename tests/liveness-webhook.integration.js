const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// lib/twilio.ts has no imports, so transpiling it to CommonJS and evaluating
// it is enough to exercise the real implementation.
function loadTs(file) {
  const source = read(file);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const module = { exports: {} };
  new Function("exports", "require", "module", outputText)(module.exports, require, module);
  return module.exports;
}

const twilio = loadTs("backend/convex/lib/twilio.ts");

// Worked example from https://www.twilio.com/docs/usage/security
const DOCS_VECTOR = {
  authToken: "12345",
  url: "https://example.com/myapp.php?foo=1&bar=2",
  params: {
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675310",
    Digits: "1234",
    From: "+14158675310",
    To: "+18005551212",
  },
  signature: "L/OH5YylLD5NRKLltdqwSvS0BnU=",
};

// Independent reference implementation using node:crypto.
function nodeTwilioSign(url, params, authToken) {
  const keys = Object.keys(params).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = url + keys.map((key) => key + params[key]).join("");
  return crypto.createHmac("sha1", authToken).update(canonical).digest("base64");
}

function formParams(params) {
  return new URLSearchParams(new URLSearchParams(params).toString());
}

test("node:crypto reference reproduces the Twilio documentation signature", () => {
  assert.equal(nodeTwilioSign(DOCS_VECTOR.url, DOCS_VECTOR.params, DOCS_VECTOR.authToken), DOCS_VECTOR.signature);
});

test("verifyTwilioSignature accepts the Twilio documentation example", async () => {
  const ok = await twilio.verifyTwilioSignature(
    DOCS_VECTOR.url,
    formParams(DOCS_VECTOR.params),
    DOCS_VECTOR.signature,
    DOCS_VECTOR.authToken,
  );
  assert.equal(ok, true);
});

test("verifyTwilioSignature accepts a standard form-encoded delivery callback", async () => {
  const url = "https://example.convex.site/webhooks/liveness/delivery";
  const params = { MessageSid: "SM_mock_123", MessageStatus: "delivered", To: "+254700000000", AccountSid: "AC123" };
  const signature = nodeTwilioSign(url, params, "local-auth-token");
  assert.equal(await twilio.verifyTwilioSignature(url, formParams(params), signature, "local-auth-token"), true);
});

test("verifyTwilioSignature rejects tampered, missing or malformed signatures", async () => {
  const { url, params, signature, authToken } = DOCS_VECTOR;
  assert.equal(await twilio.verifyTwilioSignature(url, formParams({ ...params, Digits: "9999" }), signature, authToken), false);
  assert.equal(await twilio.verifyTwilioSignature(url + "&x=1", formParams(params), signature, authToken), false);
  assert.equal(await twilio.verifyTwilioSignature(url, formParams(params), signature, "wrong-token"), false);
  assert.equal(await twilio.verifyTwilioSignature(url, formParams(params), null, authToken), false);
  assert.equal(await twilio.verifyTwilioSignature(url, formParams(params), "not base64!!", authToken), false);
  assert.equal(await twilio.verifyTwilioSignature(url, formParams(params), "c2hvcnQ=", authToken), false);
  assert.equal(await twilio.verifyTwilioSignature(url, formParams(params), signature, ""), false);
});

test("signature payload sorts parameter names by code point, not locale", async () => {
  const params = { a: "1", B: "2", _: "3", Z: "4" };
  // Code-point order: "B" (66) < "Z" (90) < "_" (95) < "a" (97).
  assert.equal(twilio.twilioSignaturePayload("https://x.test/cb", formParams(params)), "https://x.test/cbB2Z4_3a1");
  const signature = nodeTwilioSign("https://x.test/cb", params, "tok");
  assert.equal(await twilio.verifyTwilioSignature("https://x.test/cb", formParams(params), signature, "tok"), true);
});

test("maps Twilio delivery statuses onto forward-only delivery states", () => {
  const map = twilio.mapTwilioDeliveryStatus;
  for (const status of ["queued", "accepted", "scheduled", "sending", "sent"]) assert.equal(map(status), "sent");
  assert.equal(map("delivered"), "delivered");
  assert.equal(map("read"), "delivered");
  assert.equal(map("undelivered"), "undelivered");
  assert.equal(map("failed"), "failed");
  assert.equal(map("canceled"), "failed");
  // Unknown statuses never fail a verification.
  assert.equal(map("some_new_status"), "sent");
  assert.equal(map(null), "sent");
});

test("delivery webhook route verifies the Twilio signature before acting", () => {
  const http = read("backend/convex/http.ts");
  assert.match(http, /new URLSearchParams\(rawBody\)/);
  assert.match(http, /X-Twilio-Signature/);
  assert.match(http, /verifyTwilioSignature\(/);
  assert.match(http, /applyDeliveryCallback/);
  assert.ok(http.indexOf("verifyTwilioSignature(") < http.indexOf("applyDeliveryCallback"), "signature is checked before the mutation runs");
});

test("liveness callbacks are idempotent and delivery failures fail the verification", () => {
  const liveness = read("backend/convex/liveness.ts");
  assert.match(liveness, /export const applyDeliveryCallback/);
  assert.match(liveness, /export const applyCallback/);
  assert.match(liveness, /if \(row\.status !== "pending"\) return \{ accepted: true, duplicate: true \}/);
  assert.match(liveness, /by_provider_message/);
  assert.match(liveness, /DELIVERY_RANK\[args\.deliveryStatus\] <= DELIVERY_RANK\[row\.deliveryStatus\]/);
  assert.match(liveness, /internal\.verifications\._fail/);
  assert.match(liveness, /internal\.verifications\._completeWithReview/);
  assert.match(liveness, /internal\.webhooks\.dispatchWebhook/);
  assert.doesNotMatch(liveness, /"unknown"/, "no placeholder provider message ids");
});

const africasTalking = loadTs("backend/convex/lib/africasTalking.ts");

test("Africa's Talking: sandbox username uses the sandbox host", () => {
  assert.equal(africasTalking.africasTalkingSmsUrl("sandbox"), "https://api.sandbox.africastalking.com/version1/messaging");
  assert.equal(africasTalking.africasTalkingSmsUrl("deeptrack"), "https://api.africastalking.com/version1/messaging");
});

test("Africa's Talking: request body sends the sender id only when set", () => {
  const withSender = africasTalking.africasTalkingSmsBody({ username: "u", to: "+254700000000", message: "hi", senderId: " DEEPTRACK " });
  assert.equal(withSender.get("from"), "DEEPTRACK");
  assert.equal(withSender.get("to"), "+254700000000");
  const without = africasTalking.africasTalkingSmsBody({ username: "u", to: "+254700000000", message: "hi" });
  assert.equal(without.has("from"), false);
});

test("Africa's Talking: accepted recipients return the message id", () => {
  for (const statusCode of [100, 101, 102]) {
    const outcome = africasTalking.parseAfricasTalkingSendResponse({
      SMSMessageData: { Recipients: [{ statusCode, status: "Success", number: "+254700000000", messageId: "ATXid_abc" }] },
    });
    assert.deepEqual(outcome, { ok: true, sid: "ATXid_abc" });
  }
});

test("Africa's Talking: rejected, empty or id-less responses fail", () => {
  const parse = africasTalking.parseAfricasTalkingSendResponse;
  const rejected = parse({ SMSMessageData: { Recipients: [{ statusCode: 405, status: "InsufficientBalance", messageId: "None" }] } });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /InsufficientBalance/);
  assert.equal(parse({ SMSMessageData: { Recipients: [] } }).ok, false);
  assert.equal(parse(null).ok, false);
  assert.equal(parse({ SMSMessageData: { Recipients: [{ statusCode: 101, messageId: "None" }] } }).ok, false);
  assert.equal(parse({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } }).ok, false);
});

test("Africa's Talking: maps delivery report statuses onto forward-only delivery states", () => {
  const map = africasTalking.mapAfricasTalkingDeliveryStatus;
  for (const status of ["Sent", "Submitted", "Buffered"]) assert.equal(map(status), "sent");
  assert.equal(map("Success"), "delivered");
  assert.equal(map("AbsentSubscriber"), "undelivered");
  assert.equal(map("Expired"), "undelivered");
  assert.equal(map("Failed"), "failed");
  assert.equal(map("Rejected"), "failed");
  assert.equal(map("SomethingNew"), "sent");
  assert.equal(map(null), "sent");
});

test("Africa's Talking: callback token must match exactly", () => {
  const match = africasTalking.callbackTokenMatches;
  assert.equal(match("s3cret-token", "s3cret-token"), true);
  assert.equal(match("s3cret-tokeN", "s3cret-token"), false);
  assert.equal(match("s3cret", "s3cret-token"), false);
  assert.equal(match(null, "s3cret-token"), false);
  assert.equal(match("s3cret-token", undefined), false);
  assert.equal(match("", ""), false);
});

test("Africa's Talking delivery route checks the token before acting", () => {
  const http = read("backend/convex/http.ts");
  const start = http.indexOf('"/webhooks/liveness/delivery/africastalking"');
  assert.ok(start > 0, "route exists");
  const route = http.slice(start);
  assert.ok(route.indexOf("callbackTokenMatches(") < route.indexOf("applyDeliveryCallback"), "token is checked before the mutation runs");
  assert.match(route, /AFRICASTALKING_CALLBACK_TOKEN/);
});

test("liveness SMS uses Africa's Talking when configured and WhatsApp stays on Twilio", () => {
  const liveness = read("backend/convex/liveness.ts");
  assert.match(liveness, /request\.method === "sms" && atUsername && atApiKey/);
  assert.match(liveness, /AFRICASTALKING_SENDER_ID/);
  assert.match(liveness, /TWILIO_WHATSAPP_FROM/);
});
