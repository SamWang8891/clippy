/**
 * Spread onto every field that must not draw password-manager prompts. There
 * is no standard: each extension reads only its own attribute, so all of them
 * go on every field. Browsers' own managers ignore these; `autoComplete` is
 * chosen per field for those (see the connection ID field).
 *
 * ponytail: covers the managers that document an opt-out. NordPass, Keeper,
 * Enpass and RoboForm publish none; add theirs here if they ever do.
 */
export const NO_PASSWORD_MANAGERS = {
    'data-1p-ignore': '', // 1Password
    'data-lpignore': 'true', // LastPass reads only the literal "true"
    'data-bwignore': 'true', // Bitwarden
    'data-protonpass-ignore': 'true', // Proton Pass
    'data-form-type': 'other', // Dashlane
};
