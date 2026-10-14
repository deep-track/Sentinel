// goAML report XML for Kenya's Financial Reporting Centre (FRC), which takes
// suspicious transaction and activity reports through UNODC goAML. Sentinel
// prepares a draft from a case: the reporting entity and person, the
// subject, the reason and action, and (for an STR) one transaction. The
// compliance officer checks it against FRC's current schema and guidance,
// completes anything it needs (indicator codes, transaction mode codes),
// and uploads or re-keys it in goAML. Sentinel never files it.

export type GoamlReportCode = "STR" | "SAR";

export type GoamlInput = {
  reportCode: GoamlReportCode;
  rentityId: string;
  rentityBranch?: string;
  entityReference: string; // the client's own reference for the report
  submissionDate: Date;
  localCurrency: "KES" | "USD";
  reportingPerson: { firstName: string; lastName: string; email?: string; phone?: string; title?: string };
  location: { address?: string; city?: string; countryCode: string };
  reason: string;
  action: string;
  indicators: string[];
  subject:
    | {
        kind: "person";
        firstName: string;
        lastName: string;
        birthDate?: string; // YYYY-MM-DD
        idNumber?: string;
        nationality?: string; // ISO-2
        country?: string; // ISO-2 residence
      }
    | { kind: "entity"; name: string; registrationNumber?: string; incorporationCountry?: string };
  // STR only.
  transaction?: {
    number: string;
    date: Date;
    amount: number;
    description: string;
    transmodeCode?: string;
    counterpartyName?: string;
    counterpartyAccount?: string;
  };
};

export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function el(name: string, value: string | number | undefined | null, indent: string): string {
  if (value === undefined || value === null || value === "") return "";
  return `${indent}<${name}>${escapeXml(String(value))}</${name}>\n`;
}

// goAML dates are ISO date-times without a zone.
export function goamlDate(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function isoDay(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : undefined;
}

function countryCode(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function partyXml(subject: GoamlInput["subject"], indent: string): string {
  if (subject.kind === "person") {
    const inner = `${indent}  `;
    const id = subject.idNumber
      ? `${inner}<identification>\n${el("type", "ID", `${inner}  `)}${el("number", subject.idNumber, `${inner}  `)}${el("issue_country", countryCode(subject.nationality ?? subject.country), `${inner}  `)}${inner}</identification>\n`
      : "";
    return (
      `${indent}<person>\n` +
      el("first_name", subject.firstName, inner) +
      el("last_name", subject.lastName, inner) +
      el("birthdate", isoDay(subject.birthDate), inner) +
      el("id_number", subject.idNumber, inner) +
      el("nationality1", countryCode(subject.nationality), inner) +
      el("residence", countryCode(subject.country), inner) +
      id +
      `${indent}</person>\n`
    );
  }
  const inner = `${indent}  `;
  return (
    `${indent}<entity>\n` +
    el("name", subject.name, inner) +
    el("incorporation_number", subject.registrationNumber, inner) +
    el("incorporation_country_code", countryCode(subject.incorporationCountry), inner) +
    `${indent}</entity>\n`
  );
}

export function buildGoamlXml(input: GoamlInput): string {
  const i1 = "  ";
  const i2 = "    ";
  const i3 = "      ";
  const person = input.reportingPerson;
  let body = "";
  if (input.reportCode === "STR" && input.transaction) {
    const t = input.transaction;
    // The subject is the reporting entity's own customer.
    const party = "t_from_my_client";
    body =
      `${i1}<transaction>\n` +
      el("transactionnumber", t.number, i2) +
      el("transaction_description", t.description, i2) +
      el("date_transaction", goamlDate(t.date), i2) +
      el("transmode_code", t.transmodeCode, i2) +
      el("amount_local", t.amount.toFixed(2), i2) +
      `${i2}<${party}>\n` +
      el("from_funds_code", "K", i3) +
      (input.subject.kind === "person"
        ? partyXml(input.subject, i3).replace(/<(\/?)person>/g, "<$1from_person>")
        : partyXml(input.subject, i3).replace(/<(\/?)entity>/g, "<$1from_entity>")) +
      el("from_country", countryCode(input.subject.kind === "person" ? input.subject.country : input.subject.incorporationCountry) ?? input.location.countryCode, i3) +
      `${i2}</${party}>\n` +
      (t.counterpartyName || t.counterpartyAccount
        ? `${i2}<t_to>\n${el("to_funds_code", "K", i3)}${
            t.counterpartyAccount
              ? `${i3}<to_account>\n${el("account", t.counterpartyAccount, `${i3}  `)}${el("account_name", t.counterpartyName, `${i3}  `)}${i3}</to_account>\n`
              : `${i3}<to_person>\n${el("last_name", t.counterpartyName, `${i3}  `)}${i3}</to_person>\n`
          }${i2}</t_to>\n`
        : "") +
      `${i1}</transaction>\n`;
  } else {
    body =
      `${i1}<activity>\n` +
      `${i2}<report_parties>\n` +
      `${i3}<report_party>\n` +
      partyXml(input.subject, `${i3}  `) +
      el("reason", input.reason, `${i3}  `) +
      `${i3}</report_party>\n` +
      `${i2}</report_parties>\n` +
      `${i1}</activity>\n`;
  }
  const indicators = input.indicators.map((code) => code.trim()).filter(Boolean);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<report>\n` +
    el("rentity_id", input.rentityId, i1) +
    el("rentity_branch", input.rentityBranch, i1) +
    el("submission_code", "E", i1) +
    el("report_code", input.reportCode, i1) +
    el("entity_reference", input.entityReference, i1) +
    el("submission_date", goamlDate(input.submissionDate), i1) +
    el("currency_code_local", input.localCurrency, i1) +
    `${i1}<reporting_person>\n` +
    el("first_name", person.firstName, i2) +
    el("last_name", person.lastName, i2) +
    el("title", person.title, i2) +
    el("email", person.email, i2) +
    (person.phone ? `${i2}<phones>\n${i3}<phone>\n${el("tph_contact_type", "1", `${i3}  `)}${el("tph_communication_type", "L", `${i3}  `)}${el("tph_number", person.phone, `${i3}  `)}${i3}</phone>\n${i2}</phones>\n` : "") +
    `${i1}</reporting_person>\n` +
    `${i1}<location>\n` +
    el("address_type", "B", i2) +
    el("address", input.location.address, i2) +
    el("city", input.location.city, i2) +
    el("country_code", input.location.countryCode, i2) +
    `${i1}</location>\n` +
    el("reason", input.reason, i1) +
    el("action", input.action, i1) +
    body +
    (indicators.length ? `${i1}<report_indicators>\n${indicators.map((code) => el("indicator", code, i2)).join("")}${i1}</report_indicators>\n` : "") +
    `</report>\n`
  );
}

// "Jane Wanjiru Kamau" → first "Jane Wanjiru", last "Kamau".
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: parts[0] ?? "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
