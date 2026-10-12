const CLOCK = {hour: '2-digit', minute: '2-digit'};
const defaultClock = new Intl.DateTimeFormat(undefined, CLOCK);

/**
 * Hours and minutes in the reader's locale, with a space between the day
 * period and the digits wherever the locale runs them together — zh-TW writes
 * "下午07:15", which reads as one word. Locales that already space it out,
 * like "07:15 PM" or "오후 07:15", come back untouched.
 *
 * @param {Date} date
 * @param {string} [locale] defaults to the browser's
 * @returns {string}
 */
export function formatClock(date, locale) {
    const parts = (locale ? new Intl.DateTimeFormat(locale, CLOCK) : defaultClock).formatToParts(date);
    return parts.map((part, i) => {
        const prev = parts[i - 1];
        const touching = prev && prev.type !== 'literal' && part.type !== 'literal'
            && (prev.type === 'dayPeriod' || part.type === 'dayPeriod');
        return (touching ? ' ' : '') + part.value;
    }).join('');
}
