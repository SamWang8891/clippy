/**
 * Code-block marker encoding.
 *
 * When a user explicitly marks content as "code", we prepend an in-band
 * sentinel so the same backend text-block schema carries extra format
 * metadata. The sentinel uses control characters that never appear in
 * user-typed prose, keeping the parser unambiguous.
 *
 *   \x01clippy:code\x01\n{body}            — code, auto-detect language
 *   \x01clippy:code:python\x01\n{body}     — code, explicit language
 *
 * Plain text has no prefix and is returned as-is.
 */

export const SUPPORTED_LANGUAGES = [
    {id: 'auto', label: 'Auto-detect'},
    {id: 'javascript', label: 'JavaScript'},
    {id: 'typescript', label: 'TypeScript'},
    {id: 'python', label: 'Python'},
    {id: 'go', label: 'Go'},
    {id: 'rust', label: 'Rust'},
    {id: 'java', label: 'Java'},
    {id: 'kotlin', label: 'Kotlin'},
    {id: 'swift', label: 'Swift'},
    {id: 'c', label: 'C'},
    {id: 'cpp', label: 'C++'},
    {id: 'csharp', label: 'C#'},
    {id: 'ruby', label: 'Ruby'},
    {id: 'php', label: 'PHP'},
    {id: 'bash', label: 'Shell / Bash'},
    {id: 'sql', label: 'SQL'},
    {id: 'json', label: 'JSON'},
    {id: 'yaml', label: 'YAML'},
    {id: 'xml', label: 'XML / HTML'},
    {id: 'css', label: 'CSS'},
    {id: 'markdown', label: 'Markdown'},
    {id: 'plaintext', label: 'Plain (no highlight)'},
];

const PREFIX = '\x01clippy:code';
const TERMINATOR = '\x01\n';

export function encodeCodeBlock(body, language) {
    const lang = language && language !== 'auto' ? `:${language}` : '';
    return `${PREFIX}${lang}${TERMINATOR}${body}`;
}

/**
 * Parse a block's plaintext. Returns `{format, language, body}` where:
 *   format:    'code' | 'text'
 *   language:  string | null  (only set when explicitly declared)
 *   body:      the content to render (sentinel stripped)
 */
export function parseBlockContent(text) {
    if (typeof text !== 'string' || !text.startsWith(PREFIX)) {
        return {format: 'text', language: null, body: text ?? ''};
    }
    const end = text.indexOf(TERMINATOR, PREFIX.length);
    if (end === -1) {
        return {format: 'text', language: null, body: text};
    }
    const meta = text.substring(PREFIX.length, end);
    const language = meta.startsWith(':') ? meta.substring(1) : null;
    const body = text.substring(end + TERMINATOR.length);
    return {format: 'code', language: language || null, body};
}
