import React from 'react';
import './Notification.css';

export function Notification({ text }) {
  return (
    <div className="notification">
      {text}
    </div>
  );
}
