const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// The approved outline of the user manual ("Sentinel User Manual: Outline").
const OUTLINE = {
  a: [
    "Signing up and your free trial",
    "Choosing a plan and paying",
    "The dashboard at a glance",
    "Your organization profile",
    "Team members and roles",
    "Security and single sign-on",
    "Screening rules",
    "Review rules",
    "Notifications",
    "The audit log",
    "Data retention and data requests",
    "Usage and reports",
  ],
  b: [
    "How Sentinel decides",
    "KYC identity checks",
    "Capture links: KYC on the customer's phone",
    "Remote liveness",
    "Document checks",
    "AML screening",
    "Ongoing monitoring",
    "Business checks (KYB)",
    "Reading a report and its PDF",
    "Fraud signals explained",
    "Deciding a review case",
    "Customer risk and periodic reviews",
    "Transaction monitoring",
    "Filing an STR or SAR",
    "Disputes",
  ],
  c: ["Quick start", "KYC API", "Documents API", "AML and monitoring API", "Transactions API", "Results and credits", "Webhooks", "KYB and capture links API"],
  d: [
    "The Back Office at a glance",
    "Review queue and disputes",
    "Clients, plans and billing",
    "The Kenyan PEP register",
    "Kenyan risk lists and FATF countries",
    "Compliance tasks",
    "Platform health and quality",
  ],
};

// Every manual is written.
const WRITTEN = Object.keys(OUTLINE);

const SECTIONS = ["What it's for", "Who can use it", "Step by step", "What each result means", "Common questions", "Related chapters"];
const ALL_IDS = new Set(Object.entries(OUTLINE).flatMap(([manual, titles]) => titles.map((_, i) => `${manual}${i + 1}`)));

function chapterFile(manual, id) {
  const dir = path.join(root, "content", "help", manual);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith(`${id}-`) && name.endsWith(".md")) : [];
  assert.equal(files.length, 1, `exactly one file for ${id} in content/help/${manual}`);
  return path.join("content", "help", manual, files[0]);
}

function frontMatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  assert.ok(match, "front matter");
  return Object.fromEntries(
    match[1].split(/\r?\n/).map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
  );
}

for (const manual of WRITTEN) {
  test(`every chapter of Manual ${manual.toUpperCase()} in the outline has a file`, () => {
    const dir = path.join(root, "content", "help", manual);
    assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith(".md")).length, OUTLINE[manual].length, "no extra chapters");
    OUTLINE[manual].forEach((title, i) => {
      const id = `${manual}${i + 1}`;
      const source = read(chapterFile(manual, id));
      const fields = frontMatter(source);
      assert.equal(fields.id, id);
      assert.equal(fields.title, title, `${id} title matches the outline`);
      assert.ok(fields.summary, `${id} has a summary`);
      assert.ok(fields.roles, `${id} lists roles`);
    });
  });

  test(`Manual ${manual.toUpperCase()} chapters follow the template`, () => {
    OUTLINE[manual].forEach((_, i) => {
      const id = `${manual}${i + 1}`;
      const source = read(chapterFile(manual, id));
      const prose = source.replace(/^```[\s\S]*?^```/gm, "");
      const headings = [...prose.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
      assert.deepEqual(headings, SECTIONS, `${id} has the six sections in order`);
      assert.doesNotMatch(prose, /^# /m, `${id} has no H1`);
      for (const [, href] of source.matchAll(/\]\((\/(?:internal-ops\/)?help\/[^)\s#]+)/g)) {
        if (href.startsWith("/help/shots/")) continue;
        const target = href.split("/").pop();
        assert.ok(ALL_IDS.has(target), `${id} links to a chapter in the outline (${href})`);
        if (manual !== "d") assert.doesNotMatch(href, /internal-ops|\/help\/d\d/, `${id} never links client readers to Manual D`);
      }
      for (const [, src, title] of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g)) {
        assert.match(src, new RegExp(`^/help/shots/${id}-[a-z0-9-]+\\.png$`), `${id} screenshot path ${src}`);
        // A placeholder ("TODO") until it's taken; then a real image in public/.
        if (title !== "TODO") {
          assert.equal(title, undefined, `${id} screenshot ${src} is a placeholder ("TODO") or has no title`);
          // Manual D's screenshots are private (content/help/d/shots/, served to staff only).
          const file = manual === "d" ? path.join(root, "content", "help", "d", "shots", path.basename(src)) : path.join(root, "public", src);
          assert.ok(fs.existsSync(file), `${id} screenshot ${src} exists`);
        }
      }
    });
  });
}

test("Help is in the sidebar and client routes never serve Manual D", () => {
  assert.match(read("components/app-sidebar.tsx"), /\{ title: "Help", url: "\/help", icon: HelpCircle \}/);
  const help = read("backend/lib/help.ts");
  assert.match(help, /export const CLIENT_MANUALS: ManualId\[\] = \["a", "b", "c"\];/);
  for (const page of ["app/(platform)/help/page.tsx", "app/(platform)/help/[chapter]/page.tsx"]) {
    const source = read(page);
    assert.match(source, /CLIENT_MANUALS/, page);
    assert.doesNotMatch(source, /"d"/, page);
  }
  assert.match(read("next.config.ts"), /"\/help\/\*": \["\.\/content\/help\/\{a,b,c\}\/\*\*\/\*"\]/);
});

test("Manual D is served only inside the Back Office", () => {
  assert.match(read("backend/lib/help.ts"), /export const INTERNAL_MANUALS: ManualId\[\] = \["d"\];/);
  for (const page of ["app/internal-ops/help/page.tsx", "app/internal-ops/help/[chapter]/page.tsx"]) {
    assert.match(read(page), /INTERNAL_MANUALS/, page);
  }
  assert.match(read("app/internal-ops/ops-nav.tsx"), /\{ title: "Runbook", url: "\/internal-ops\/help", icon: BookOpen \}/);
  assert.match(read("next.config.ts"), /"\/internal-ops\/help\/\*": \["\.\/content\/help\/d\/\*\*\/\*"\]/);
  // The Back Office layout is what keeps the runbook internal.
  assert.match(read("app/internal-ops/layout.tsx"), /if \(!isInternalOpsRole\(user\.role\)\) redirect\("\/dashboard"\);/);
});

test("Manual D screenshots are never public and are served to staff only", () => {
  assert.deepEqual(fs.readdirSync(path.join(root, "public", "help", "shots")).filter((name) => /^d\d/.test(name)), [], "no runbook images in public/");
  const route = read("app/internal-ops/help/shots/[file]/route.ts");
  assert.match(route, /if \(!user\) return new NextResponse\("Sign in required", \{ status: 401 \}\);/);
  assert.match(route, /if \(!isInternalOpsRole\(user\.role\)\) return new NextResponse\("Not found", \{ status: 404 \}\);/);
  assert.match(route, /if \(!authAvailable && !devBypass\) return new NextResponse/);
  assert.ok(route.includes(String.raw`if (!/^d\d+-[a-z0-9-]+\.png$/.test(file))`), "only runbook file names, no paths");
  assert.match(route, /"Cache-Control": "private, max-age=3600"/);
  assert.match(read("backend/lib/help.ts"), /href\.replace\("\/help\/shots\/", "\/internal-ops\/help\/shots\/"\)/);
  assert.match(read("next.config.ts"), /"\/internal-ops\/help\/shots\/\*": \["\.\/content\/help\/d\/shots\/\*"\]/);
});
