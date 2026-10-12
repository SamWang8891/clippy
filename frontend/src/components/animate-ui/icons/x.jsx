// Vendored from Animate UI (https://animate-ui.com, registry item `icons-x`),
// ported from TSX to JS; the animations are upstream's, unchanged.
import * as React from 'react';
import {motion} from 'motion/react';

import {getVariants, useAnimateIconContext, IconWrapper} from './icon';

const animations = {
  default: {
    line1: {
      initial: {
        rotate: 0,
        transition: { ease: 'easeInOut', duration: 0.4 },
      },
      animate: {
        rotate: 90,
        transition: { ease: 'easeInOut', duration: 0.4 },
      },
    },
    line2: {
      initial: {
        rotate: 0,
        transition: { ease: 'easeInOut', duration: 0.4, delay: 0.1 },
      },
      animate: {
        rotate: 90,
        transition: { ease: 'easeInOut', duration: 0.4, delay: 0.1 },
      },
    },
  },
  plus: {
    line1: {
      initial: {
        rotate: 0,
        x1: 6,
        y1: 18,
        x2: 18,
        y2: 6,
        transition: { ease: 'easeInOut', duration: 0.3, delay: 0.1 },
      },
      animate: {
        rotate: 45,
        x1: 7.1,
        y1: 16.9,
        x2: 16.9,
        y2: 7.1,
        transition: { ease: 'easeInOut', duration: 0.3, delay: 0.1 },
      },
    },
    line2: {
      initial: {
        rotate: 0,
        x1: 6,
        y1: 6,
        x2: 18,
        y2: 18,
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
      animate: {
        rotate: 45,
        x1: 7.1,
        y1: 7.1,
        x2: 16.9,
        y2: 16.9,
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
    },
  },
};

function IconComponent({size, ...props}) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.line
        x1={6}
        y1={18}
        x2={18}
        y2={6}
        variants={variants.line1}
        initial="initial"
        animate={controls}
      />
      <motion.line
        x1={6}
        y1={6}
        x2={18}
        y2={18}
        variants={variants.line2}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function X(props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export { animations, X, X as XIcon };
