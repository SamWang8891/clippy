import React from 'react';
import {AnimatePresence, motion} from 'motion/react';
import './UndoBar.css';

// Shown on touch screens only, where there is no Cmd/Ctrl+Z to press; a
// keyboard gets the key and nothing on screen.
export const SHOWS_UNDO_BAR = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(hover: none)').matches);
const QUICK = {duration: 0.2, ease: [0.2, 0, 0, 1]};

/** The latest change that can be taken back, and a button for it. */
export function UndoBar({step, onUndo}) {
    if (!SHOWS_UNDO_BAR) return null;
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
                    <button type="button" className="undo-button" onClick={onUndo}>Undo</button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
