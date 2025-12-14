import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '../context/SessionContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { getSession, createTextBlock, uploadFileBlock, deleteBlock } from '../utils/api';
import { decrypt } from '../utils/encryption';
import { BlockItem } from './BlockItem';
import { Menu } from './Menu';
import { Notification } from './Notification';
import './ClipboardInterface.css';

export function ClipboardInterface() {
  const { sessionData, clearSession } = useSession();
  const [session, setSession] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [users, setUsers] = useState([]);
  const [showMenu, setShowMenu] = useState(false);
  const [notification, setNotification] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newBlockType, setNewBlockType] = useState('text');

  // Fetch session data
  useEffect(() => {
    if (sessionData?.session_id) {
      loadSession();
    }
  }, [sessionData]);

  const loadSession = async () => {
    try {
      const data = await getSession(sessionData.session_id);
      setSession(data);
      setUsers(data.users);
      setBlocks(data.blocks);
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

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
    sessionData?.session_id,
    sessionData?.user_id,
    handleWebSocketMessage
  );

  const showNotification = (text) => {
    setNotification(text);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleCreateTextBlock = async (content) => {
    try {
      await createTextBlock(sessionData.session_id, sessionData.user_id, content);
      setIsCreating(false);
    } catch (err) {
      alert('Failed to create block: ' + err.message);
    }
  };

  const handleUploadFile = async (file) => {
    try {
      await uploadFileBlock(sessionData.session_id, sessionData.user_id, file);
      setIsCreating(false);
    } catch (err) {
      alert('Failed to upload file: ' + err.message);
    }
  };

  const handleDeleteBlock = async (blockId) => {
    try {
      await deleteBlock(sessionData.session_id, sessionData.user_id, blockId);
    } catch (err) {
      alert('Failed to delete block: ' + err.message);
    }
  };

  const handleLogoClick = () => {
    if (confirm('Leave this session and return to home?')) {
      clearSession();
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
              Session: <strong>{sessionData?.session_id}</strong>
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
              sessionId={sessionData.session_id}
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
