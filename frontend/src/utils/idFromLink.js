/**
 * The connection ID in a link pasted whole, or null when the text is not an
 * http(s) link. A share link ends in the ID, so it is the last part of the
 * path — the query string, a fragment or a trailing slash do not get in the
 * way, as they would counting characters from the end of the text.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function idFromLink(text) {
    const trimmed = text.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
        return new URL(trimmed).pathname.split('/').filter(Boolean).pop() ?? '';
    } catch {
        return null;
    }
}
