// Vendored from Animate UI (https://animate-ui.com, registry item `icons-plus`),
// ported from TSX to JS; the animations are upstream's, unchanged.
import * as React from 'react';
import {motion} from 'motion/react';

import {getVariants, useAnimateIconContext, IconWrapper} from './icon';

const animations = {
  default: {
    line1: {
      initial: {
        rotate: 0,
        transition: { ease: 'easeInOut', duration: 0.4, delay: 0.1 },
      },
      animate: {
        rotate: 90,
        transition: { ease: 'easeInOut', duration: 0.4, delay: 0.1 },
      },
    },
    line2: {
      initial: {
        rotate: 0,
        transition: { ease: 'easeInOut', duration: 0.4 },
      },
      animate: {
        rotate: 90,
        transition: { ease: 'easeInOut', duration: 0.4 },
      },
    },
  },
  x: {
    line1: {
      initial: {
        rotate: 0,
        x1: 12,
        y1: 19,
        x2: 12,
        y2: 5,
        transition: { ease: 'easeInOut', duration: 0.3, delay: 0.1 },
      },
      animate: {
        rotate: 45,
        x1: 12,
        y1: 20.5,
        x2: 12,
        y2: 3.5,
        transition: { ease: 'easeInOut', duration: 0.3, delay: 0.1 },
      },
    },
    line2: {
      initial: {
        rotate: 0,
        x1: 5,
        y1: 12,
        x2: 19,
        y2: 12,
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
      animate: {
        rotate: 45,
        x1: 3.5,
        y1: 12,
        x2: 20.5,
        y2: 12,
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
        x1={12}
        y1={19}
        x2={12}
        y2={5}
        variants={variants.line1}
        initial="initial"
        animate={controls}
      />
      <motion.line
        x1={5}
        y1={12}
        x2={19}
        y2={12}
        variants={variants.line2}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Plus(props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Plus,
  Plus as PlusIcon,
};
