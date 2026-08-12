import {flushSync} from 'react-dom';

/**
 * Run a React state update inside a browser view transition, so the DOM change
 * crossfades instead of snapping.
 *
 * flushSync is the whole point: React batches updates, so without it the browser
 * takes its "before" snapshot and the change lands after the transition has
 * already started — nothing moves.
 *
 * ponytail: no polyfill and no fallback animation. Browsers without the API, and
 * anyone who asked for less motion, get the plain instant update.
 */
export function viewTransition(update) {
    const apply = () => flushSync(update);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !document.startViewTransition) {
        apply();
        return;
    }
    document.startViewTransition(apply);
}
