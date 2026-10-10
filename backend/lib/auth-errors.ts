// Narrow detection of errors that mean "the session cookie is unusable"
// (cannot be decrypted, is malformed, or has expired). Anything else — network
// failures, misconfiguration, SDK bugs — must surface instead of silently
// logging the user out.

const RECOVERABLE_JOSE_CODES = new Set([
	"ERR_JWE_DECRYPTION_FAILED",
	"ERR_JWE_INVALID",
	"ERR_JWT_EXPIRED",
	"ERR_JWT_INVALID",
	"ERR_JWT_CLAIM_VALIDATION_FAILED",
]);

const RECOVERABLE_JOSE_NAMES = new Set([
	"JWEDecryptionFailed",
	"JWEInvalid",
	"JWTExpired",
	"JWTInvalid",
	"JWTClaimValidationFailed",
]);

const RECOVERABLE_MESSAGES = [
	"invalid compact jwe",
	"decryption operation failed",
	"jwe decryption failed",
];

export function isRecoverableSessionError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const code = (error as { code?: unknown }).code;
	if (typeof code === "string" && RECOVERABLE_JOSE_CODES.has(code)) return true;
	if (RECOVERABLE_JOSE_NAMES.has(error.name)) return true;

	const message = error.message.toLowerCase();
	return RECOVERABLE_MESSAGES.some((fragment) => message.includes(fragment));
}
