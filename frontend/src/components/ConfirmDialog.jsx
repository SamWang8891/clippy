import React, { useEffect, useId, useRef } from 'react';
import './ConfirmDialog.css';

export function ConfirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmStyle = 'danger',
  onConfirm,
  onCancel
}) {
  const confirmRef = useRef(null);
  const id = useId();

  // Opens on the action it was asked for, so Enter carries it out and the
  // choice is visible at a glance; Esc and the backdrop back out. Focus goes
  // back where it came from once the dialog is gone.
  useEffect(() => {
    const previous = document.activeElement;
    confirmRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous && previous !== document.body && previous.isConnected) previous.focus();
    };
  }, [onCancel]);

  return (
    <>
      <div className="confirm-overlay" onClick={onCancel} />
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
      >
        <div className="confirm-content">
          <h3 className="confirm-title" id={`${id}-title`}>{title}</h3>
          <p className="confirm-message" id={`${id}-message`}>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="confirm-button cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            className={`confirm-button ${confirmStyle}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </>
  );
}
