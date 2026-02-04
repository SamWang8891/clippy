import React, {useEffect, useState} from 'react';
import {useToast} from '../context/ToastContext';
import {decrypt} from '../utils/encryption';
import {getDownloadUrl} from '../utils/api';
import './BlockItem.css';

export function BlockItem({block, sessionId, onDelete}) {
    const [decryptedContent, setDecryptedContent] = useState('');
    const [isDecrypting, setIsDecrypting] = useState(false);
    const toast = useToast();

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
        toast.success('Copied to clipboard!');
    };

    const handleDownload = async () => {
        try {
            // Fetch the encrypted file
            const response = await fetch(getDownloadUrl(sessionId, block.id));
            const encryptedData = await response.text();

            // Decrypt the base64 data
            const decryptedBase64 = decrypt(encryptedData);

            // Convert base64 back to binary
            const binaryString = atob(decryptedBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Create blob and trigger download
            const blob = new Blob([bytes]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = block.original_filename || block.filename || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast.success('File downloaded successfully');
        } catch (err) {
            console.error('Download error:', err);
            toast.error('Failed to download file');
        }
    };

    return (
        <div className="block-item">
            <div className="block-header">
        <span className="block-type">
          {block.type === 'text' ? (
              <>
                  <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"
                       fill="currentColor">
                      <path
                          d="M200-280h560v-80H200v80Zm0-160h560v-80H200v80Zm0-160h400v-80H200v80Zm-40 440q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Z"/>
                  </svg>
                  <span>Text</span>
              </>
          ) : (
              <>
                  <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"
                       fill="currentColor">
                      <path
                          d="M240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h360l200 200v520q0 33-23.5 56.5T720-80H240Zm0-80h480v-480H560v-160H240v640Zm240-40q67 0 113.5-47T640-360v-160h-80v160q0 33-23 56.5T480-280q-33 0-56.5-23.5T400-360v-220q0-9 6-14.5t14-5.5q9 0 14.5 5.5T440-580v220h80v-220q0-42-29-71t-71-29q-42 0-71 29t-29 71v220q0 66 47 113t113 47ZM240-800v160-160 640-640Z"/>
                  </svg>
                  <span>File</span>
              </>
          )}
        </span>
                <div className="block-actions">
                    {block.type === 'text' && (
                        <button onClick={handleCopy} title="Copy to clipboard">
                            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"
                                 fill="currentColor">
                                <path
                                    d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
                            </svg>
                        </button>
                    )}
                    {block.type === 'file' && (
                        <button onClick={handleDownload} title="Download file">
                            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"
                                 fill="currentColor">
                                <path
                                    d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
                            </svg>
                        </button>
                    )}
                    <button onClick={() => onDelete(block.id)} className="delete-button" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px"
                             fill="currentColor">
                            <path
                                d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>
                        </svg>
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
                        <div className="file-name">{block.original_filename || block.filename}</div>
                        <div className="file-meta">
                            Created: {new Date(block.created_at).toLocaleString()}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
