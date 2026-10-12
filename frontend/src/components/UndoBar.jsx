import React from 'react';
import {AnimatePresence, motion} from 'motion/react';
import './UndoBar.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const QUICK = {duration: 0.2, ease: [0.2, 0, 0, 1]};

/**
 * The latest change that can be taken back, and a button for it: there is no
 * shortcut key on a phone. How long is left is not shown.
 */
export function UndoBar({step, onUndo}) {
    return (
        <AnimatePresence>
            {step && (
                <motion.div
                    className="undo-bar"
                    role="status"
                    initial={{opacity: 0, y: 12}}
                    animate={{opacity: 1, y: 0}}
                    exit={{opacity: 0, y: 12, transition: {duration: 0.15}}}
                    transition={QUICK}
                >
                    <span className="undo-label">{step.label}</span>
                    <button type="button" className="undo-button" onClick={onUndo}>
                        Undo
                        <kbd className="undo-key" aria-hidden="true">{IS_MAC ? '⌘Z' : 'Ctrl+Z'}</kbd>
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
