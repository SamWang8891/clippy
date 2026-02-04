import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '../context/SessionContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { getSession, createTextBlock, uploadFileBlock, deleteBlock } from '../utils/api';
import { decrypt } from '../utils/encryption';
import { BlockItem } from './BlockItem';
import { Menu } from './Menu';
import { Notification } from './Notification';
import './ClipboardInterface.css';

export function Id({ sessionData }) {
  const [showQrPopup, setShowQrPopup] = useState(false);
  const qrButtonRef = useRef(null);
  const popupRef = useRef(null);

  const handleCopyUrl = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      alert('URL copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy URL:', err);
      alert('Failed to copy URL');
    }
  };

  const handleToggleQr = () => {
    setShowQrPopup(!showQrPopup);
  };

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showQrPopup &&
          popupRef.current &&
          !popupRef.current.contains(event.target) &&
          qrButtonRef.current &&
          !qrButtonRef.current.contains(event.target)) {
        setShowQrPopup(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showQrPopup]);

  const currentUrl = window.location.href;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(currentUrl)}`;

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      Connection ID: <strong>{sessionData?.connection_id}</strong>
      <button onClick={handleCopyUrl} title="Copy URL to clipboard" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
        <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
          <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
        </svg>
      </button>
      <button ref={qrButtonRef} onClick={handleToggleQr} title="Show QR code" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
        <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
          <path d="M120-520v-320h320v320H120Zm80-80h160v-160H200v160Zm-80 480v-320h320v320H120Zm80-80h160v-160H200v160Zm320-320v-320h320v320H520Zm80-80h160v-160H600v160Zm160 480v-80h80v80h-80ZM520-360v-80h80v80h-80Zm80 80v-80h80v80h-80Zm-80 80v-80h80v80h-80Zm80 80v-80h80v80h-80Zm80-80v-80h80v80h-80Zm0-160v-80h80v80h-80Zm80 80v-80h80v80h-80Z"/>
        </svg>
      </button>

      {showQrPopup && (
        <div ref={popupRef} style={{
          position: 'absolute',
          top: '100%',
          right: '0',
          marginTop: '8px',
          background: 'white',
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000
        }}>
          <div style={{
            position: 'absolute',
            top: '-8px',
            right: '20px',
            width: '0',
            height: '0',
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderBottom: '8px solid #ddd'
          }}></div>
          <div style={{
            position: 'absolute',
            top: '-7px',
            right: '21px',
            width: '0',
            height: '0',
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderBottom: '7px solid white'
          }}></div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '500' }}>Scan to join session</p>
            <img src={qrCodeUrl} alt="QR Code" style={{ display: 'block', margin: '0 auto' }} />
            <p style={{ margin: '12px 0 0 0', fontSize: '12px', color: '#666', wordBreak: 'break-all' }}>{currentUrl}</p>
            <button onClick={() => setShowQrPopup(false)} style={{
              marginTop: '12px',
              padding: '6px 16px',
              background: '#f0f0f0',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}


export function ClipboardInterface() {
  const { sessionData, clearSession } = useSession();
  const [session, setSession] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [users, setUsers] = useState([]);
  const [showMenu, setShowMenu] = useState(false);
  const [notification, setNotification] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newBlockType, setNewBlockType] = useState('text');

  // Fetch session data and ensure URL is correct
  useEffect(() => {
    if (sessionData?.connection_id) {
      loadSession();
      // Ensure URL matches the session ID
      const currentPath = window.location.pathname.replace('/', '');
      if (currentPath !== sessionData.connection_id) {
        window.history.replaceState({}, '', `/${sessionData.connection_id}`);
      }
    }
  }, [sessionData]);

  const loadSession = async () => {
    try {
      const data = await getSession(sessionData.connection_id);
      setSession(data);
      setUsers(data.users);
      setBlocks(data.blocks);
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  // Validate session on page refresh/mount
  useEffect(() => {
    const validateSession = async () => {
      if (sessionData?.connection_id) {
        try {
          // Try to fetch the session to see if it still exists
          await getSession(sessionData.connection_id);
        } catch (err) {
          // Session doesn't exist or is invalid
          const shouldGoHome = confirm(
            'Your session has expired or is no longer available. Would you like to return to the home page?'
          );

          if (shouldGoHome) {
            clearSession();
            // Clear URL back to home
            window.history.pushState({}, '', '/');
            window.location.reload();
          }
        }
      }
    };

    validateSession();
  }, []); // Empty dependency array = runs once on mount

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((message) => {
    switch (message.type) {
      case 'user_joined':
        setUsers((prev) => [...prev, message.user]);
        showNotification(`${message.user.name} joined the session`);
        break;

      case 'user_left':
        setUsers((prev) => prev.filter((u) => u.id !== message.user_id));
        const leftUser = users.find((u) => u.id === message.user_id);
        if (leftUser) {
          showNotification(`${leftUser.name} left the session`);
        }
        break;

      case 'block_created':
        setBlocks((prev) => [...prev, message.block]);
        break;

      case 'block_deleted':
        setBlocks((prev) => prev.filter((b) => b.id !== message.block_id));
        break;

      case 'host_transferred':
        setUsers((prev) =>
          prev.map((u) => ({ ...u, is_host: u.id === message.new_host_id }))
        );
        setSession((prev) => ({ ...prev, host_id: message.new_host_id }));
        if (message.new_host_id === sessionData.user_id) {
          showNotification('You are now the host');
        }
        break;

      case 'join_permission_changed':
        setSession((prev) => ({ ...prev, allow_join: message.allow_join }));
        break;

      case 'session_destroyed':
        showNotification('Session has been destroyed');
        setTimeout(() => {
          window.location.reload();
        }, 2000);
        break;
    }
  }, [users, sessionData]);

  const { isConnected } = useWebSocket(
    sessionData?.connection_id,
    sessionData?.user_id,
    handleWebSocketMessage
  );

  const showNotification = (text) => {
    setNotification(text);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleCreateTextBlock = async (content) => {
    try {
      await createTextBlock(sessionData.connection_id, sessionData.user_id, content);
      setIsCreating(false);
    } catch (err) {
      alert('Failed to create block: ' + err.message);
    }
  };

  const handleUploadFile = async (file) => {
    try {
      await uploadFileBlock(sessionData.connection_id, sessionData.user_id, file);
      setIsCreating(false);
    } catch (err) {
      alert('Failed to upload file: ' + err.message);
    }
  };

  const handleDeleteBlock = async (blockId) => {
    try {
      await deleteBlock(sessionData.connection_id, sessionData.user_id, blockId);
    } catch (err) {
      alert('Failed to delete block: ' + err.message);
    }
  };

  const handleLogoClick = () => {
    if (confirm('Leave this session and return to home?')) {
      clearSession();
      // Clear URL back to home
      window.history.pushState({}, '', '/');
      window.location.reload();
    }
  };

  const currentUser = users.find((u) => u.id === sessionData?.user_id);

  return (
    <div className="clipboard-interface">
      <header className="header">
        <div className="header-left">
          <h1 onClick={handleLogoClick} style={{ cursor: 'pointer' }}>Clippy</h1>
          <div className="session-info">
            <div className="session-id">
              {/*Connection ID: <strong>{sessionData?.connection_id}</strong>*/}
              <Id sessionData={sessionData}/>
            </div>
            {currentUser && (
              <div className="user-name">
                {currentUser.name}
                {currentUser.is_host && <span className="host-icon" title="Host">👑</span>}
              </div>
            )}
          </div>
        </div>
        <div className="header-right">
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Connected' : '○ Disconnected'}
          </div>
          <button className="menu-button" onClick={() => setShowMenu(!showMenu)}>
            ☰
          </button>
        </div>
      </header>

      {showMenu && (
        <Menu
          session={session}
          users={users}
          currentUser={currentUser}
          onClose={() => setShowMenu(false)}
        />
      )}

      <main className="main-content">
        <div className="blocks-container">
          {blocks.map((block) => (
            <BlockItem
              key={block.id}
              block={block}
              sessionId={sessionData.connection_id}
              onDelete={handleDeleteBlock}
            />
          ))}

          {isCreating ? (
            <div className="new-block-form">
              <div className="form-header">
                <select
                  value={newBlockType}
                  onChange={(e) => setNewBlockType(e.target.value)}
                >
                  <option value="text">Text Block</option>
                  <option value="file">File Upload</option>
                </select>
                <button onClick={() => setIsCreating(false)}>Cancel</button>
              </div>

              {newBlockType === 'text' ? (
                <TextBlockForm onSubmit={handleCreateTextBlock} />
              ) : (
                <FileUploadForm onSubmit={handleUploadFile} />
              )}
            </div>
          ) : (
            <button className="add-block-button" onClick={() => setIsCreating(true)}>
              + Add Block
            </button>
          )}
        </div>
      </main>

      {notification && <Notification text={notification} />}
    </div>
  );
}

function TextBlockForm({ onSubmit }) {
  const [content, setContent] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (content.trim()) {
      onSubmit(content);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="text-block-form">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Enter your text here..."
        rows={6}
        autoFocus
      />
      <button type="submit">Done</button>
    </form>
  );
}

function FileUploadForm({ onSubmit }) {
  const [file, setFile] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (file) {
      onSubmit(file);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="file-upload-form">
      <input
        type="file"
        onChange={(e) => setFile(e.target.files[0])}
        required
      />
      {file && (
        <div className="file-info">
          Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
        </div>
      )}
      <button type="submit" disabled={!file}>
        Upload
      </button>
    </form>
  );
}
