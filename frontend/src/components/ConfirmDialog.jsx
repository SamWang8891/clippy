import React, { useEffect, useId, useRef } from 'react';
import './ConfirmDialog.css';

export function ConfirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmStyle = 'danger',
  extraText,
  onConfirm,
  onCancel,
  onExtra
}) {
  const confirmRef = useRef(null);
  const dialogRef = useRef(null);
  const id = useId();

  // Opens on the action it was asked for, so Enter carries it out and the
  // choice is visible at a glance; Esc and the backdrop back out. Focus goes
  // back where it came from once the dialog is gone. Tab goes round the two
  // answers: walking off into the page behind could open a second question
  // over this one.
  useEffect(() => {
    const previous = document.activeElement;
    confirmRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const buttons = [...dialogRef.current.querySelectorAll('button')];
        const at = buttons.indexOf(document.activeElement);
        buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
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
        ref={dialogRef}
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
          {/* A third way out, set apart on the left: the destructive one
              that is not the default. */}
          {onExtra && (
            <button className="confirm-button extra" onClick={onExtra}>
              {extraText}
            </button>
          )}
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
