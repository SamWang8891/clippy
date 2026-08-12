// node --test src/utils/motion.test.js
//
// The only thing worth guarding here is that the update always lands. A wrong
// branch would not look like a missing animation, it would look like the app
// ignoring the click.
import {test} from 'node:test';
import assert from 'node:assert/strict';

const stub = ({reduced, supported}) => {
    let started = false;
    globalThis.window = {matchMedia: () => ({matches: reduced})};
    globalThis.document = supported
        ? {startViewTransition: (fn) => { started = true; fn(); }}
        : {};
    return () => started;
};

const {viewTransition} = await import('./motion.js');

test('runs the update through the browser transition when it is available', () => {
    const startedTransition = stub({reduced: false, supported: true});
    let ran = false;
    viewTransition(() => { ran = true; });
    assert.equal(ran, true);
    assert.equal(startedTransition(), true);
});

test('still runs the update when the browser has no view transitions', () => {
    const startedTransition = stub({reduced: false, supported: false});
    let ran = false;
    viewTransition(() => { ran = true; });
    assert.equal(ran, true);
    assert.equal(startedTransition(), false);
});

test('skips the transition when less motion was asked for', () => {
    const startedTransition = stub({reduced: true, supported: true});
    let ran = false;
    viewTransition(() => { ran = true; });
    assert.equal(ran, true);
    assert.equal(startedTransition(), false);
});
