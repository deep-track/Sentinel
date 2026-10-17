const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the demo helper finds clients by isDemo and filters their rows", () => {
  const helper = read("backend/convex/lib/demo.ts");
  assert.match(helper, /export async function demoClientIds\(/);
  assert.match(helper, /filter\(\(client\) => client\.isDemo\)/);
  assert.match(helper, /export function withoutDemo</);
  assert.match(helper, /!demo\.has\(row\.clientId\)/);
});

test("every Back Office total leaves the demo organization out", () => {
  const queries = {
    "backend/convex/admin.ts": "export const opsOverview",
    "backend/convex/backOfficeBilling.ts": "export const overview",
    "backend/convex/backOfficeClients.ts": "export const clientHealth",
    "backend/convex/backOfficeCompliance.ts": "export const riskDashboard",
    "backend/convex/backOfficeQuality.ts": "export const quality",
    "backend/convex/backOfficeReviews.ts": "export const reviewOperations",
    "backend/convex/backOfficeHealth.ts": "export const serviceHealth",
    "backend/convex/monitoring.ts": "export const overview",
  };
  for (const [file, marker] of Object.entries(queries)) {
    const source = read(file);
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${file}: ${marker}`);
    const next = source.indexOf("\nexport const ", start + marker.length);
    const body = source.slice(start, next === -1 ? undefined : next);
    assert.match(body, /demoClientIds\(ctx\)/, `${file}: ${marker} loads the demo clients`);
  }
});

test("the Clients list still shows Demo Bank, tagged as demo", () => {
  assert.match(read("backend/convex/admin.ts"), /isDemo: client\.isDemo === true,/);
  assert.match(read("app/internal-ops/clients/client-accounts.tsx"), /client\.isDemo \? <Badge tone="blue">Demo — not in totals<\/Badge>/);
});
