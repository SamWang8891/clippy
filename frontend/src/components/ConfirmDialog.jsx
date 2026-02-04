import React from 'react';
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
  return (
    <>
      <div className="confirm-overlay" onClick={onCancel} />
      <div className="confirm-dialog">
        <div className="confirm-content">
          <h3 className="confirm-title">{title}</h3>
          <p className="confirm-message">{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="confirm-button cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
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
