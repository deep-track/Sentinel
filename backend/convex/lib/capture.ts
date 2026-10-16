// Kenya capture (capture.ts): a link the client sends by SMS or WhatsApp
// (or shares itself) where the customer photographs their ID and takes a
// selfie on their phone, in English or Swahili. The link carries a random
// token; only its SHA-256 is stored.

export const CAPTURE_LANGUAGES = ["en", "sw"] as const;
export type CaptureLanguage = (typeof CAPTURE_LANGUAGES)[number];

export const CAPTURE_DOCUMENT_TYPES = ["id_card", "passport", "driving_license"] as const;
export type CaptureDocumentType = (typeof CAPTURE_DOCUMENT_TYPES)[number];

// How long a link works.
export const CAPTURE_LINK_HOURS = 72;

export type CaptureStatus = "pending" | "opened" | "submitted" | "expired" | "cancelled";

export type CapturePrefill = { firstName?: string; lastName?: string; idNumber?: string; dateOfBirth?: string; gender?: string };

export const REQUIRED_DETAILS = ["firstName", "lastName", "idNumber", "dateOfBirth", "gender"] as const;

// The details the customer still has to type in.
export function missingDetails(prefill: CapturePrefill | null | undefined): Array<(typeof REQUIRED_DETAILS)[number]> {
  return REQUIRED_DETAILS.filter((field) => !prefill?.[field]?.trim());
}

export function effectiveStatus(session: { status: CaptureStatus; expiresAt: number }, now: number): CaptureStatus {
  if ((session.status === "pending" || session.status === "opened") && session.expiresAt <= now) return "expired";
  return session.status;
}

export function captureMessage(language: CaptureLanguage, clientName: string, link: string): string {
  return language === "sw"
    ? `${clientName} inakuomba uthibitishe utambulisho wako. Fungua kiungo hiki salama ndani ya saa ${CAPTURE_LINK_HOURS}: ${link}`
    : `${clientName} asks you to verify your identity. Open this secure link within ${CAPTURE_LINK_HOURS} hours: ${link}`;
}

export function captureLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/verify/${token}`;
}

// A token is 64 hex characters (32 random bytes).
export function isCaptureToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

// The words on the customer's screens, in English and Swahili.
export const CAPTURE_TEXT = {
  en: {
    title: "Verify your identity",
    intro: (client: string) => `${client} uses Sentinel by DeepTrack to verify your identity. It takes about 3 minutes. You'll need your ID card or passport and good light.`,
    consentTitle: "Your consent",
    consent: (client: string) =>
      `I agree that ${client} and its verification provider DeepTrack may process the photos of my ID and my face, and my ID details, to verify my identity and to prevent fraud, as required by law. My data is protected under the Kenya Data Protection Act, 2019.`,
    agree: "I agree, start",
    documentType: "Which document will you use?",
    documentTypes: { id_card: "National ID card", passport: "Passport", driving_license: "Driving licence" },
    front: "Photograph the front of your document",
    back: "Photograph the back of your document",
    selfie: "Take a selfie",
    frontHint: "Place it on a flat, dark surface. All four corners must show, with no glare.",
    backHint: "Turn it over and take a photo of the back.",
    selfieHint: "Look straight at the camera. Remove glasses and hats. Use good light.",
    takePhoto: "Take photo",
    retake: "Retake",
    next: "Continue",
    back_: "Back",
    details: "Your details",
    detailsHint: "Enter them exactly as they are on your document.",
    firstName: "First name",
    lastName: "Last name",
    idNumber: "ID or passport number",
    dateOfBirth: "Date of birth",
    gender: "Gender",
    genders: { male: "Male", female: "Female" },
    submit: "Submit",
    sending: "Sending securely…",
    done: "Thank you",
    doneText: (client: string) => `Your photos were sent to ${client}. You can close this page.`,
    expired: "This link has expired. Ask for a new one.",
    used: "This link has already been used.",
    cancelled: "This link was cancelled.",
    invalid: "This link isn't valid. Check that you opened the whole link.",
    retry: "That didn't work. Check your connection and try again.",
    compressing: "Preparing photo…",
    language: "Kiswahili",
  },
  sw: {
    title: "Thibitisha utambulisho wako",
    intro: (client: string) => `${client} inatumia Sentinel by DeepTrack kuthibitisha utambulisho wako. Inachukua takriban dakika 3. Utahitaji kitambulisho chako au pasipoti, na mwanga mzuri.`,
    consentTitle: "Idhini yako",
    consent: (client: string) =>
      `Ninakubali kwamba ${client} na mtoa huduma wake wa uthibitishaji DeepTrack wanaweza kuchakata picha za kitambulisho changu na uso wangu, pamoja na maelezo ya kitambulisho changu, ili kuthibitisha utambulisho wangu na kuzuia ulaghai, kama inavyotakiwa na sheria. Data yangu inalindwa chini ya Sheria ya Ulinzi wa Data ya Kenya, 2019.`,
    agree: "Ninakubali, anza",
    documentType: "Utatumia hati gani?",
    documentTypes: { id_card: "Kitambulisho cha taifa", passport: "Pasipoti", driving_license: "Leseni ya udereva" },
    front: "Piga picha ya upande wa mbele wa hati yako",
    back: "Piga picha ya upande wa nyuma wa hati yako",
    selfie: "Jipige picha (selfie)",
    frontHint: "Iweke juu ya sehemu tambarare yenye rangi nyeusi. Pembe zote nne zionekane, bila mng'ao.",
    backHint: "Igeuze na upige picha ya upande wa nyuma.",
    selfieHint: "Tazama kamera moja kwa moja. Ondoa miwani na kofia. Tumia mwanga mzuri.",
    takePhoto: "Piga picha",
    retake: "Piga tena",
    next: "Endelea",
    back_: "Rudi",
    details: "Maelezo yako",
    detailsHint: "Yaandike kama yalivyo kwenye hati yako.",
    firstName: "Jina la kwanza",
    lastName: "Jina la mwisho",
    idNumber: "Nambari ya kitambulisho au pasipoti",
    dateOfBirth: "Tarehe ya kuzaliwa",
    gender: "Jinsia",
    genders: { male: "Mwanaume", female: "Mwanamke" },
    submit: "Tuma",
    sending: "Inatuma kwa usalama…",
    done: "Asante",
    doneText: (client: string) => `Picha zako zimetumwa kwa ${client}. Unaweza kufunga ukurasa huu.`,
    expired: "Kiungo hiki kimeisha muda wake. Omba kipya.",
    used: "Kiungo hiki kimeshatumika.",
    cancelled: "Kiungo hiki kimeghairiwa.",
    invalid: "Kiungo hiki si sahihi. Hakikisha umefungua kiungo chote.",
    retry: "Imeshindikana. Angalia mtandao wako na ujaribu tena.",
    compressing: "Inaandaa picha…",
    language: "English",
  },
} as const;
