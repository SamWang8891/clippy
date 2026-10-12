// Vendored from Animate UI (https://animate-ui.com, registry item
// `primitives-animate-slot`), ported from TSX to JS. The one change: `cn` is a
// plain class join, since there is no Tailwind here for tailwind-merge to fold.
import * as React from 'react';
import {motion, isMotionComponent} from 'motion/react';

const cn = (...classes) => classes.filter(Boolean).join(' ');

function mergeRefs(...refs) {
    return (node) => {
        refs.forEach((ref) => {
            if (!ref) return;
            if (typeof ref === 'function') {
                ref(node);
            } else {
                ref.current = node;
            }
        });
    };
}

function mergeProps(childProps, slotProps) {
    const merged = {...childProps, ...slotProps};

    if (childProps.className || slotProps.className) {
        merged.className = cn(childProps.className, slotProps.className);
    }

    if (childProps.style || slotProps.style) {
        merged.style = {...childProps.style, ...slotProps.style};
    }

    return merged;
}

function Slot({children, ref, ...props}) {
    const isAlreadyMotion =
        typeof children.type === 'object' &&
        children.type !== null &&
        isMotionComponent(children.type);

    const Base = React.useMemo(
        () => (isAlreadyMotion ? children.type : motion.create(children.type)),
        [isAlreadyMotion, children.type],
    );

    if (!React.isValidElement(children)) return null;

    const {ref: childRef, ...childProps} = children.props;

    const mergedProps = mergeProps(childProps, props);

    return <Base {...mergedProps} ref={mergeRefs(childRef, ref)} />;
}

export {Slot};
