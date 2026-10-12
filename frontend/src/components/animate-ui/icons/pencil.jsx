// Not from Animate UI, which has no pencil: written here against its icon API
// (getVariants / IconWrapper), like pen.jsx. Paths are Lucide's `pencil`, with
// the slash its `pencil-off` crosses it with. At rest the slash is drawn —
// editing kept to the host; `unlock` draws it back as editing is handed out,
// the way the padlock's shackle springs open.
import * as React from 'react';
import {motion} from 'motion/react';

import {getVariants, useAnimateIconContext, IconWrapper} from './icon';

const scribble = {
  rotate: [0, -10, 8, -4, 0],
  transformOrigin: 'bottom left',
  transition: {duration: 0.6, ease: 'easeInOut'},
};

// Settling back to rest runs under `default`, so it has to be the one that
// draws the slash in again.
const drawn = {pathLength: 1, opacity: 1, transition: {duration: 0.3, ease: 'easeInOut'}};

const animations = {
  default: {
    body: {initial: {rotate: 0}, animate: scribble},
    slash: {initial: drawn, animate: drawn},
  },
  unlock: {
    body: {initial: {rotate: 0}, animate: scribble},
    slash: {
      initial: drawn,
      animate: {pathLength: 0, opacity: 0, transition: {duration: 0.3, ease: 'easeInOut'}},
    },
  },
};

function IconComponent({size, ...props}) {
  const {controls} = useAnimateIconContext();
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
      <motion.g variants={variants.body} initial="initial" animate={controls}>
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
        <path d="m15 5 4 4" />
      </motion.g>
      <motion.path d="m2 2 20 20" variants={variants.slash} initial="initial" animate={controls} />
    </motion.svg>
  );
}

function Pencil(props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {animations, Pencil, Pencil as PencilIcon};
