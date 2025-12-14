import React, { useState, useEffect } from 'react';
import { decrypt } from '../utils/encryption';
import { getDownloadUrl } from '../utils/api';
import './BlockItem.css';

export function BlockItem({ block, sessionId, onDelete }) {
  const [decryptedContent, setDecryptedContent] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);

  useEffect(() => {
    if (block.type === 'text' && block.content) {
      setIsDecrypting(true);
      try {
        const decrypted = decrypt(block.content);
        setDecryptedContent(decrypted);
      } catch (err) {
        setDecryptedContent('Failed to decrypt content');
      } finally {
        setIsDecrypting(false);
      }
    }
  }, [block]);

  const handleCopy = () => {
    navigator.clipboard.writeText(decryptedContent);
    alert('Copied to clipboard!');
  };

  const handleDownload = () => {
    window.open(getDownloadUrl(sessionId, block.id), '_blank');
  };

  return (
    <div className="block-item">
      <div className="block-header">
        <span className="block-type">{block.type === 'text' ? '📝 Text' : '📎 File'}</span>
        <div className="block-actions">
          {block.type === 'text' && (
            <button onClick={handleCopy} title="Copy to clipboard">
              📋
            </button>
          )}
          {block.type === 'file' && (
            <button onClick={handleDownload} title="Download file">
              ⬇️
            </button>
          )}
          <button onClick={() => onDelete(block.id)} className="delete-button" title="Delete">
            🗑️
          </button>
        </div>
      </div>

      <div className="block-content">
        {block.type === 'text' ? (
          isDecrypting ? (
            <div className="loading">Decrypting...</div>
          ) : (
            <pre>{decryptedContent}</pre>
          )
        ) : (
          <div className="file-info">
            <div className="file-name">{block.filename}</div>
            <div className="file-meta">
              Created: {new Date(block.created_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
