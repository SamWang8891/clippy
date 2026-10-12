// Not from Animate UI, which has no grip: written here against its icon API
// (getVariants / IconWrapper) so it answers the same triggers as the vendored
// icons. Dots are Lucide's `grip-vertical`; they part vertically to say "this
// moves up and down".
import * as React from 'react';
import {motion} from 'motion/react';

import {getVariants, useAnimateIconContext, IconWrapper} from './icon';

const animations = {
  default: {
    top: {
      initial: {
        y: 0,
      },
      animate: {
        y: -2,
        transition: {
          duration: 0.3,
          ease: 'easeInOut',
        },
      },
    },
    middle: {},
    bottom: {
      initial: {
        y: 0,
      },
      animate: {
        y: 2,
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
      <motion.g variants={variants.top} initial="initial" animate={controls}>
        <circle cx={9} cy={5} r={1} />
        <circle cx={15} cy={5} r={1} />
      </motion.g>
      <motion.g variants={variants.middle} initial="initial" animate={controls}>
        <circle cx={9} cy={12} r={1} />
        <circle cx={15} cy={12} r={1} />
      </motion.g>
      <motion.g variants={variants.bottom} initial="initial" animate={controls}>
        <circle cx={9} cy={19} r={1} />
        <circle cx={15} cy={19} r={1} />
      </motion.g>
    </motion.svg>
  );
}

function GripVertical(props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export { animations, GripVertical, GripVertical as GripVerticalIcon };
