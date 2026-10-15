// Pure OFAC SDN / UN Consolidated / EU FSF / UK Sanctions List XML parsers.
// No Convex imports, so they can be unit tested directly.
import { normalizeName, type SourceKey } from "./amlMatching";

export type NormalizedEntry = {
  sourceRecordId: string;
  entityType: "individual" | "entity" | "unknown";
  primaryName: string;
  aliases: string[];
  normalizedNames: string[];
  countries: string[];
  programs: string[];
  identifiers?: unknown;
};

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    // Last, so "&amp;lt;" decodes to "&lt;" rather than "<".
    .replace(/&amp;/g, "&")
    .trim();
}

// `<TAG>` or `<TAG attr="...">`, but never `<TAG_SUFFIX>`.
function tagPattern(tag: string, flags: string): RegExp {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, flags);
}

function innerText(xml: string): string {
  return decodeXml(xml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function tagValue(block: string, tag: string): string | undefined {
  const match = block.match(tagPattern(tag, "i"));
  if (!match) return undefined;
  return innerText(match[1]) || undefined;
}

export function tagValues(block: string, tag: string): string[] {
  return Array.from(block.matchAll(tagPattern(tag, "gi")))
    .map((match) => innerText(match[1]))
    .filter(Boolean);
}

function tagBlocks(block: string, tag: string): string[] {
  return Array.from(block.matchAll(tagPattern(tag, "gi"))).map((match) => match[1]);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nameFromParts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// Nested OFAC lists whose children reuse top-level tag names (an aka has its
// own <firstName>/<lastName>/<uid>). Stripped before reading the entry's own
// name, uid and type.
const OFAC_NESTED_LISTS =
  /<(akaList|addressList|idList|nationalityList|citizenshipList|dateOfBirthList|placeOfBirthList|vesselInfo)\b[\s\S]*?<\/\1>/gi;

function ofacEntityType(sdnType: string | undefined): NormalizedEntry["entityType"] {
  const value = sdnType?.trim().toLowerCase();
  if (!value) return "unknown";
  return value === "individual" ? "individual" : "entity";
}

export function parseOfac(xml: string): NormalizedEntry[] {
  const blocks = Array.from(xml.matchAll(/<sdnEntry\b[\s\S]*?<\/sdnEntry>/gi)).map((m) => m[0]);
  if (blocks.length === 0) throw new Error("OFAC response did not contain sdnEntry records");
  return blocks.map((block, index) => {
    const top = block.replace(OFAC_NESTED_LISTS, " ");
    const primaryName = nameFromParts([tagValue(top, "firstName"), tagValue(top, "lastName")]);
    const aliases = unique(
      tagBlocks(block, "aka").map((aka) => nameFromParts([tagValue(aka, "firstName"), tagValue(aka, "lastName")])),
    );
    const programs = unique(tagValues(block, "program"));
    // <country> appears in addresses and inside nationality/citizenship
    // entries; reading <nationality> itself would also pick up its <uid>.
    const countries = unique(tagValues(block, "country"));
    const sourceRecordId = tagValue(top, "uid") ?? `ofac-${index + 1}`;
    const names = unique([primaryName, ...aliases]);
    return {
      sourceRecordId,
      entityType: ofacEntityType(tagValue(top, "sdnType")),
      primaryName: primaryName || sourceRecordId,
      aliases,
      normalizedNames: unique(names.map(normalizeName)),
      countries,
      programs,
      identifiers: { uid: sourceRecordId },
    };
  });
}

// Alias names only. QUALITY ("Good"/"Low") is metadata, never part of a name.
function unAliases(block: string): string[] {
  return unique(
    [...tagBlocks(block, "INDIVIDUAL_ALIAS"), ...tagBlocks(block, "ENTITY_ALIAS")].flatMap((alias) =>
      tagValues(alias, "ALIAS_NAME"),
    ),
  );
}

function unCountries(block: string): string[] {
  const nationalities = tagBlocks(block, "NATIONALITY").flatMap((nationality) => {
    const values = tagValues(nationality, "VALUE");
    return values.length > 0 ? values : [innerText(nationality)];
  });
  return unique([...nationalities, ...tagValues(block, "COUNTRY")]);
}

export function parseUn(xml: string): NormalizedEntry[] {
  const blocks = Array.from(xml.matchAll(/<(INDIVIDUAL|ENTITY)\b[^>]*>[\s\S]*?<\/\1>/gi)).map((m) => ({
    block: m[0],
    type: m[1].toUpperCase(),
  }));
  if (blocks.length === 0) throw new Error("UN response did not contain INDIVIDUAL or ENTITY records");
  return blocks.map(({ block, type }, index) => {
    const primaryName = nameFromParts([
      tagValue(block, "FIRST_NAME"),
      tagValue(block, "SECOND_NAME"),
      tagValue(block, "THIRD_NAME"),
      tagValue(block, "FOURTH_NAME"),
      tagValue(block, "NAME"),
    ]);
    const aliases = unAliases(block);
    const sourceRecordId = tagValue(block, "DATAID") ?? tagValue(block, "ENTITY_ID") ?? `un-${index + 1}`;
    const unListType = tagValue(block, "UN_LIST_TYPE");
    const programs = unique([...(unListType ? [unListType] : []), ...tagValues(block, "REFERENCE_NUMBER")]);
    const names = unique([primaryName, ...aliases]);
    return {
      sourceRecordId,
      entityType: type === "INDIVIDUAL" ? "individual" : "entity",
      primaryName: primaryName || sourceRecordId,
      aliases,
      normalizedNames: unique(names.map(normalizeName)),
      countries: unCountries(block),
      programs,
      identifiers: { dataId: sourceRecordId },
    };
  });
}

// An attribute's value on the first tag in `tag` (`<x a="1" b="2">`).
function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  const value = match ? decodeXml(match[1]) : "";
  return value || undefined;
}

// EU Consolidated Financial Sanctions List (FSF XML 1.1): one
// <sanctionEntity> per designation, names as <nameAlias wholeName="…">.
export function parseEu(xml: string): NormalizedEntry[] {
  const blocks = Array.from(xml.matchAll(/<sanctionEntity\b[\s\S]*?<\/sanctionEntity>/gi)).map((m) => m[0]);
  if (blocks.length === 0) throw new Error("EU response did not contain sanctionEntity records");
  return blocks.map((block, index) => {
    const opening = block.slice(0, block.indexOf(">") + 1);
    const sourceRecordId = attr(opening, "euReferenceNumber") ?? attr(opening, "logicalId") ?? `eu-${index + 1}`;
    const names = unique(Array.from(block.matchAll(/<nameAlias\b[^>]*>/gi)).map((m) => attr(m[0], "wholeName") ?? nameFromParts([attr(m[0], "firstName"), attr(m[0], "middleName"), attr(m[0], "lastName")])));
    const [primaryName = sourceRecordId, ...aliases] = names;
    const type = attr(block.match(/<subjectType\b[^>]*>/i)?.[0] ?? "", "code");
    const countries = unique(
      Array.from(block.matchAll(/<(?:citizenship|address)\b[^>]*>/gi)).flatMap((m) => {
        const description = attr(m[0], "countryDescription");
        return description && description !== "UNKNOWN" ? [description] : [];
      }),
    );
    const programs = unique(Array.from(block.matchAll(/<regulation\b[^>]*>/gi)).map((m) => attr(m[0], "programme") ?? ""));
    return {
      sourceRecordId,
      entityType: type === "person" ? "individual" : type === "enterprise" ? "entity" : "unknown",
      primaryName,
      aliases,
      normalizedNames: unique([primaryName, ...aliases].map(normalizeName)),
      countries,
      programs,
      identifiers: { euReferenceNumber: sourceRecordId },
    };
  });
}

// UK Sanctions List (FCDO XML): one <Designation> per designation, names
// split across Name1–Name6 with a NameType (Primary name / Alias).
export function parseUk(xml: string): NormalizedEntry[] {
  const blocks = Array.from(xml.matchAll(/<Designation>[\s\S]*?<\/Designation>/gi)).map((m) => m[0]);
  if (blocks.length === 0) throw new Error("UK response did not contain Designation records");
  return blocks.map((block, index) => {
    const sourceRecordId = tagValue(block, "UniqueID") ?? `uk-${index + 1}`;
    const named = tagBlocks(block, "Name").map((name) => ({
      value: nameFromParts(["Name1", "Name2", "Name3", "Name4", "Name5", "Name6"].map((tag) => tagValue(name, tag))),
      primary: /primary/i.test(tagValue(name, "NameType") ?? ""),
    }));
    const primaryName = named.find((name) => name.primary && name.value)?.value ?? named.find((name) => name.value)?.value ?? sourceRecordId;
    const aliases = unique([...named.map((name) => name.value), ...tagValues(block, "NameNonLatinScript")].filter((name) => name && name !== primaryName));
    const kind = tagValue(block, "IndividualEntityShip")?.toLowerCase();
    return {
      sourceRecordId,
      entityType: kind === "individual" ? "individual" : kind === "entity" || kind === "ship" ? "entity" : "unknown",
      primaryName,
      aliases,
      normalizedNames: unique([primaryName, ...aliases].map(normalizeName)),
      countries: unique([...tagValues(block, "Nationality"), ...tagValues(block, "AddressCountry"), ...tagValues(block, "CountryOfBirth")]),
      programs: unique(tagValues(block, "RegimeName")),
      identifiers: { uniqueId: sourceRecordId },
    };
  });
}

export function parseSource(sourceKey: SourceKey, body: string): NormalizedEntry[] {
  switch (sourceKey) {
    case "OFAC_SDN":
      return parseOfac(body);
    case "UN_CONSOLIDATED":
      return parseUn(body);
    case "EU_FSF":
      return parseEu(body);
    case "UK_SANCTIONS":
      return parseUk(body);
  }
}
