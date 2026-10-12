// Not from Animate UI, which has no pen: written here against its icon API
// (getVariants / IconWrapper) so it answers the same triggers as the vendored
// icons. Path is Lucide's `pen`.
import * as React from 'react';
import {motion} from 'motion/react';

import {getVariants, useAnimateIconContext, IconWrapper} from './icon';

const animations = {
  default: {
    path: {
      initial: {
        rotate: 0,
        x: 0,
        y: 0,
      },
      animate: {
        rotate: [0, -10, 8, -4, 0],
        x: [0, -1, 1, 0],
        y: [0, 1, -1, 0],
        transformOrigin: 'bottom left',
        transition: {
          duration: 0.6,
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
      <motion.path
        d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
        variants={variants.path}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Pen(props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export { animations, Pen, Pen as PenIcon };
