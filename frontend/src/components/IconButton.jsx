import React, {useEffect, useState} from 'react';
import {motion} from 'motion/react';
import {AnimateIcon} from './animate-ui/icons/icon';

const PRESS = {scale: 0.9};

// A touch screen fires a synthetic hover after every tap and never the leave
// that ends it, so hover animations would freeze mid-pose there. Tap only.
const CAN_HOVER = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(hover: hover)').matches);

/**
 * A button whose Animate UI icon plays when it is hovered or pressed, and that
 * gives a little under the finger. `completeOnStop` lets a quick tap run the
 * animation through instead of snapping back on release.
 *
 * `animation` names one of the icon's own variants; the default is its first.
 * `animate` plays one on its own, e.g. an entrance (see useIntro).
 */
export function IconButton({
    icon: Icon,
    size = 22,
    animation = true,
    animate,
    iconEnd = false,
    children,
    ...props
}) {
    const icon = <Icon size={size} aria-hidden="true" />;
    return (
        <AnimateIcon
            asChild
            animate={animate}
            animateOnHover={CAN_HOVER && animation}
            animateOnTap={animation}
            completeOnStop
        >
            <motion.button type="button" whileTap={props.disabled ? undefined : PRESS} {...props}>
                {iconEnd ? <>{children}{icon}</> : <>{icon}{children}</>}
            </motion.button>
        </AnimateIcon>
    );
}

/**
 * True for the first `ms` after mount, then false. Driving an icon's `animate`
 * from it plays an entrance once and then hands the icon back to its hover and
 * tap triggers — an `animate` left on would keep it "active" and swallow them.
 */
export function useIntro(ms) {
    const [playing, setPlaying] = useState(true);
    useEffect(() => {
        const timer = setTimeout(() => setPlaying(false), ms);
        return () => clearTimeout(timer);
    }, [ms]);
    return playing;
}
