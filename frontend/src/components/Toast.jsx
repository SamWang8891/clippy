import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { IconButton } from './IconButton';
import { Check } from './animate-ui/icons/check';
import { X } from './animate-ui/icons/x';
import './Toast.css';

// On a phone the stack hangs from the top of the screen, so toasts drop in
// from above; elsewhere they rise from the bottom corner.
const FROM_TOP = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 639px)').matches);
const QUICK = { duration: 0.2, ease: [0.2, 0, 0, 1] };

// Each toast keeps its own clock. It used to restart whenever any other toast
// came or went, since the close callback was new on every render. `ref` is
// what lets popLayout lift a leaving toast out of the stack.
export function Toast({ ref, id, message, type = 'info', onDismiss, duration = 3000 }) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => onDismiss(id), duration);
      return () => clearTimeout(timer);
    }
  }, [id, duration, onDismiss]);

  const icons = {
    // Drawn in as the toast arrives, so the outcome reads before the words do.
    success: <Check size={20} animate aria-hidden="true" />,
    error: <X size={20} animate aria-hidden="true" />,
    info: (
      <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
        <path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/>
      </svg>
    )
  };

  // layout="position": when one leaves, the rest slide into its place.
  return (
    <motion.div
      ref={ref}
      className={`toast toast-${type}`}
      layout="position"
      initial={{ opacity: 0, y: FROM_TOP ? -12 : 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={QUICK}
    >
      <div className="toast-icon">
        {icons[type]}
      </div>
      <div className="toast-message">{message}</div>
      <IconButton icon={X} size={16} className="toast-close" onClick={() => onDismiss(id)} aria-label="Close" />
    </motion.div>
  );
}

// popLayout lifts a leaving toast out of the stack at once, so the others
// start moving while it fades.
export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onDismiss={removeToast}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
