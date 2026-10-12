// Vendored from Animate UI (https://animate-ui.com, registry item `icons-arrow-right`),
// ported from TSX to JS; the animations are upstream's, unchanged.
import * as React from 'react';
import {motion} from 'motion/react';

import {getVariants, useAnimateIconContext, IconWrapper} from './icon';

const animations = {
  default: {
    group: {
      initial: {
        x: 0,
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
      animate: {
        x: '25%',
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
    },
    path1: {},
    path2: {},
  },
  'default-loop': {
    group: {
      initial: {
        x: 0,
      },
      animate: {
        x: [0, '25%', 0],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
    path1: {},
    path2: {},
  },
  pointing: {
    group: {},
    path1: {
      initial: {
        d: 'M5 12h14',
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
      animate: {
        d: 'M5 12h10',
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
    },
    path2: {
      initial: {
        d: 'm12 5 7 7-7 7',
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
      animate: {
        d: 'm8 5 7 7-7 7',
        transition: { ease: 'easeInOut', duration: 0.3 },
      },
    },
  },
  'pointing-loop': {
    group: {},
    path1: {
      initial: {
        d: 'M5 12h14',
      },
      animate: {
        d: ['M5 12h14', 'M5 12h10', 'M5 12h14'],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
    path2: {
      initial: {
        d: 'm12 5 7 7-7 7',
      },
      animate: {
        d: ['m12 5 7 7-7 7', 'm8 5 7 7-7 7', 'm12 5 7 7-7 7'],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
  },
  out: {
    group: {
      initial: {
        x: 0,
      },
      animate: {
        x: [0, '150%', '-150%', 0],
        transition: {
          default: { ease: 'easeInOut', duration: 0.6 },
          x: {
            ease: 'easeInOut',
            duration: 0.6,
            times: [0, 0.5, 0.5, 1],
          },
        },
      },
    },
    path1: {},
    path2: {},
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
      <motion.g variants={variants.group} initial="initial" animate={controls}>
        <motion.path
          d="M5 12h14"
          variants={variants.path1}
          initial="initial"
          animate={controls}
        />
        <motion.path
          d="m12 5 7 7-7 7"
          variants={variants.path2}
          initial="initial"
          animate={controls}
        />
      </motion.g>
    </motion.svg>
  );
}

function ArrowRight(props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  ArrowRight,
  ArrowRight as ArrowRightIcon,
};
