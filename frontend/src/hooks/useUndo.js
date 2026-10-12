import {useCallback, useEffect, useState} from 'react';

// A change can be taken back for this long after the latest one; each step
// back holds the clock this long, so the next press can follow it.
const UNDO_WINDOW_MS = 10000;
const HOLD_MS = 5000;
const MAX_STEPS = 20;
// A step this old is dropped whatever the clock says: the server keeps a
// deleted block for TRASH_SECONDS (120s), and a run of changes, each starting
// the clock over, could otherwise keep a delete on offer past that.
const MAX_STEP_AGE_MS = 90000;
const fresh = (steps, now) => steps.filter((step) => now - step.at < MAX_STEP_AGE_MS);

const CLOSED = {steps: [], deadline: 0, heldUntil: 0};

// Time left at `now`. While held, the clock reads what it read when the hold
// began; once the hold ends it runs on from there.
const timeLeft = (clock, now) => (now < clock.heldUntil ? clock.deadline - clock.heldUntil : clock.deadline - now);

/**
 * The last few changes the user can take back, newest last, and the one clock
 * that closes the window on all of them. A new change starts the clock over;
 * a step back holds it, so a run of presses walks back to where the user
 * wanted to be. The clock is never shown.
 */
export function useUndo() {
    const [clock, setClock] = useState(CLOSED);

    // `undo` runs the step back and may reject; the caller reports it.
    const record = useCallback((label, undo) => {
        const at = Date.now();
        setClock((prev) => ({
            steps: [...fresh(prev.steps, at), {label, undo, at}].slice(-MAX_STEPS),
            deadline: at + UNDO_WINDOW_MS,
            heldUntil: 0,
        }));
    }, []);

    // Takes the newest step off and holds the clock; returns it to be run.
    const takeBack = useCallback(() => {
        const at = Date.now();
        const steps = fresh(clock.steps, at);
        const step = steps.at(-1);
        if (!step) return null;
        const left = timeLeft(clock, at);
        setClock({steps: steps.slice(0, -1), heldUntil: at + HOLD_MS, deadline: at + HOLD_MS + left});
        return step;
    }, [clock]);

    // The deadline already counts any hold, so it is when the window closes.
    useEffect(() => {
        if (clock.steps.length === 0) return undefined;
        const timer = setTimeout(() => setClock(CLOSED), Math.max(0, clock.deadline - Date.now()));
        return () => clearTimeout(timer);
    }, [clock]);

    return {step: clock.steps.at(-1) ?? null, record, takeBack};
}
