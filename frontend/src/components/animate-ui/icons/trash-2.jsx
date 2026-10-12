// Vendored from Animate UI (https://animate-ui.com, registry item `icons-trash-2`),
// ported from TSX to JS; the animations are upstream's, unchanged.
import * as React from 'react';
import {motion} from 'motion/react';

import {getVariants, useAnimateIconContext, IconWrapper} from './icon';

const animations = {
  default: {
    group: {
      initial: {
        y: 0,
      },
      animate: {
        y: -1,
        transition: {
          duration: 0.3,
          ease: 'easeInOut',
        },
      },
    },
    path1: {},
    path2: {},
    path3: {
      initial: {
        y: 0,
        d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6',
      },
      animate: {
        y: 1,
        d: 'M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8',
        transition: {
          duration: 0.3,
          ease: 'easeInOut',
        },
      },
    },
    line1: {
      initial: {
        y: 0,
      },
      animate: {
        y: 1,
        transition: {
          duration: 0.3,
          ease: 'easeInOut',
        },
      },
    },
    line2: {
      initial: {
        y: 0,
      },
      animate: {
        y: 1,
        transition: {
          duration: 0.3,
          ease: 'easeInOut',
        },
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
      <motion.g variants={variants.group} initial="initial" animate={controls}>
        <motion.path
          d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
          variants={variants.path1}
          initial="initial"
          animate={controls}
        />
        <motion.path
          d="M3 6h18"
          variants={variants.path2}
          initial="initial"
          animate={controls}
        />
      </motion.g>
      <motion.path
        d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
        variants={variants.path3}
        initial="initial"
        animate={controls}
      />
      <motion.line
        x1={10}
        x2={10}
        y1={11}
        y2={17}
        variants={variants.line1}
        initial="initial"
        animate={controls}
      />
      <motion.line
        x1={14}
        x2={14}
        y1={11}
        y2={17}
        variants={variants.line2}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Trash2(props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Trash2,
  Trash2 as Trash2Icon,
};
