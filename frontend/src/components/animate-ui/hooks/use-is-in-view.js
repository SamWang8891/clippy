// Vendored from Animate UI (https://animate-ui.com, registry item
// `hooks-use-is-in-view`), ported from TSX to JS. Behaviour is unchanged.
import * as React from 'react';
import {useInView} from 'motion/react';

function useIsInView(ref, options = {}) {
    const {inView, inViewOnce = false, inViewMargin = '0px'} = options;
    const localRef = React.useRef(null);
    React.useImperativeHandle(ref, () => localRef.current);
    const inViewResult = useInView(localRef, {
        once: inViewOnce,
        margin: inViewMargin,
    });
    const isInView = !inView || inViewResult;
    return {ref: localRef, isInView};
}

export {useIsInView};
