import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  // Answers the question on screen. A second question used to replace the
  // first without answering it, and whatever awaited the first never resumed.
  const answerRef = useRef(null);

  const confirm = useCallback((options) => {
    answerRef.current?.(false);
    return new Promise((resolve) => {
      const answer = (yes) => {
        if (answerRef.current !== answer) return;  // already answered
        answerRef.current = null;
        setDialog(null);
        resolve(yes);
      };
      answerRef.current = answer;
      setDialog({
        ...options,
        onConfirm: () => answer(true),
        onCancel: () => answer(false),
      });
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && <ConfirmDialog {...dialog} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return context;
}
