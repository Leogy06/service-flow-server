// These versions identify the published documents shown by the signup form.
// Publish matching frontend documents and deploy both layers together when changing them.
export const CURRENT_TERMS_VERSION = "2026-10-17";
export const CURRENT_PRIVACY_VERSION = "2026-10-17";

// Keep previously published versions here when releasing a new version, so an
// application accepted earlier can still be reviewed without inventing consent.
export const PUBLISHED_TERMS_VERSIONS: readonly string[] = [CURRENT_TERMS_VERSION];
export const PUBLISHED_PRIVACY_VERSIONS: readonly string[] = [CURRENT_PRIVACY_VERSION];
