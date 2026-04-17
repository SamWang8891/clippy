import React, {useCallback, useEffect, useState} from 'react';
import {useSession} from '../context/SessionContext';
import {useToast} from '../context/ToastContext';
import {useConfirm} from '../context/ConfirmContext';
import {useWebSocket} from '../hooks/useWebSocket';
import {createTextBlock, deleteBlock, getSession, uploadFileBlock} from '../utils/api';
import {clearSessionKey, setSessionKey} from '../utils/encryption';
import {BlockItem} from './BlockItem';
import {Id} from './Id';
import {Menu} from './Menu';
import {Notification} from './Notification';
import './ClipboardInterface.css';


export function ClipboardInterface() {
    const {sessionData, clearSession} = useSession();
    const toast = useToast();
    const confirm = useConfirm();
    const [session, setSession] = useState(null);
    const [blocks, setBlocks] = useState([]);
    const [users, setUsers] = useState([]);
    const [showMenu, setShowMenu] = useState(false);
    const [notification, setNotification] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newBlockType, setNewBlockType] = useState('text');

    // Install the session encryption key and keep the URL in sync. The key
    // travels in the URL fragment (#…) so the server never receives it.
    useEffect(() => {
        if (!sessionData?.connection_id) return;

        try {
            setSessionKey(sessionData.encryption_key || null);
        } catch (err) {
            console.error('Failed to install session key:', err);
            setSessionKey(null);
        }

        loadSession();

        const expectedHash = sessionData.encryption_key ? `#${sessionData.encryption_key}` : '';
        const expectedUrl = `/${sessionData.connection_id}${expectedHash}`;
        const currentUrl = `${window.location.pathname}${window.location.hash}`;
        if (currentUrl !== expectedUrl) {
            window.history.replaceState({}, '', expectedUrl);
        }

        return () => {
            clearSessionKey();
        };
        // loadSession closes over sessionData; safe to omit per design.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionData]);

    const loadSession = async () => {
        try {
            const data = await getSession(sessionData.connection_id, sessionData.user_id);
            setSession(data);
            setUsers(data.users);
            setBlocks(data.blocks);
        } catch (err) {
            console.error('Failed to load session:', err);
        }
    };

    // Validate session on page refresh/mount. Intentionally runs once.
    useEffect(() => {
        const validateSession = async () => {
            if (!sessionData?.connection_id) return;
            try {
                await getSession(sessionData.connection_id, sessionData.user_id);
            } catch {
                const shouldGoHome = await confirm({
                    title: 'Connection Expired',
                    message: 'Your connection has expired or is no longer available. Would you like to return to the home page?',
                    confirmText: 'Go Home',
                    cancelText: 'Stay',
                    confirmStyle: 'primary'
                });

                if (shouldGoHome) {
                    clearSession();
                    window.history.pushState({}, '', '/');
                    window.location.reload();
                }
            }
        };

        validateSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // WebSocket message handler
    const handleWebSocketMessage = useCallback((message) => {
        switch (message.type) {
            case 'user_joined':
                setUsers((prev) => [...prev, message.user]);
                showNotification(`${message.user.name} joined the connection`);
                break;

            case 'user_left':
                setUsers((prev) => {
                    const leftUser = prev.find((u) => u.id === message.user_id);
                    if (leftUser) {
                        showNotification(`${leftUser.name} left the connection`);
                    }
                    return prev.filter((u) => u.id !== message.user_id);
                });
                break;

            case 'block_created':
                setBlocks((prev) => [...prev, message.block]);
                break;

            case 'block_deleted':
                setBlocks((prev) => prev.filter((b) => b.id !== message.block_id));
                break;

            case 'host_transferred':
                setUsers((prev) => prev.map((u) => ({...u, is_host: u.id === message.new_host_id})));
                setSession((prev) => ({...prev, host_id: message.new_host_id}));
                if (message.new_host_id === sessionData.user_id) {
                    showNotification('You are now the host');
                }
                break;

            case 'join_permission_changed':
                setSession((prev) => ({...prev, allow_join: message.allow_join}));
                break;

            case 'session_destroyed':
                showNotification('Connection has been destroyed');
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
                break;
        }
    }, [sessionData]);

    const {isConnected} = useWebSocket(sessionData?.connection_id, sessionData?.user_id, handleWebSocketMessage);

    const showNotification = (text) => {
        setNotification(text);
        setTimeout(() => setNotification(null), 3000);
    };

    const handleCreateTextBlock = async (content) => {
        try {
            await createTextBlock(sessionData.connection_id, sessionData.user_id, content);
            setIsCreating(false);
            toast.success('Text block created successfully');
        } catch (err) {
            toast.error('Failed to create block: ' + err.message);
        }
    };

    const handleUploadFile = async (file) => {
        try {
            await uploadFileBlock(sessionData.connection_id, sessionData.user_id, file);
            setIsCreating(false);
            toast.success('File uploaded successfully');
        } catch (err) {
            toast.error('Failed to upload file: ' + err.message);
        }
    };

    const handleDeleteBlock = async (blockId) => {
        try {
            await deleteBlock(sessionData.connection_id, sessionData.user_id, blockId);
            toast.success('Block deleted');
        } catch (err) {
            toast.error('Failed to delete block: ' + err.message);
        }
    };

    const handleLogoClick = async () => {
        const confirmed = await confirm({
            title: 'Leave Connection',
            message: 'Are you sure you want to leave this connection? You will need the connection ID to rejoin.',
            confirmText: 'Leave',
            cancelText: 'Stay',
            confirmStyle: 'danger'
        });

        if (confirmed) {
            clearSession();
            // Clear URL back to home
            window.history.pushState({}, '', '/');
            window.location.reload();
        }
    };

    const currentUser = users.find((u) => u.id === sessionData?.user_id);

    return (<div className="clipboard-interface">
        <header className="header">
            <div className="header-left">
                <h1 onClick={handleLogoClick} style={{cursor: 'pointer'}}>Clippy</h1>
                <div className="session-info">
                    {currentUser && (<div className="user-name">
                        {currentUser.name}
                        {currentUser.is_host && (
                            <span className="host-icon" title="Host">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16">
                                    <path d="M256 80 L340 200 L426 100 L400 320 L112 320 L86 100 L172 200 Z" fill="#F9B233"/>
                                    <rect x="96" y="340" width="320" height="60" rx="10" ry="10" fill="#F9B233"/>
                                </svg>
                            </span>
                        )}
                    </div>)}
                    <div className="session-id">
                        <Id sessionData={sessionData}/>
                    </div>
                </div>
            </div>
            <div className="header-right">
                <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? '● Connected' : '○ Disconnected'}
                </div>
                <button className={`menu-button ${showMenu ? 'active' : ''}`} onClick={() => setShowMenu(!showMenu)}>
                    ☰
                </button>
            </div>
        </header>

        {showMenu && (<Menu
            session={session}
            users={users}
            currentUser={currentUser}
            onClose={() => setShowMenu(false)}
        />)}

        <main className="main-content">
            <div className="blocks-container">
                {blocks.map((block) => (<BlockItem
                    key={block.id}
                    block={block}
                    sessionId={sessionData.connection_id}
                    userId={sessionData.user_id}
                    onDelete={handleDeleteBlock}
                />))}

                {isCreating ? (<div className="new-block-form">
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

                    {newBlockType === 'text' ? (<TextBlockForm onSubmit={handleCreateTextBlock}/>) : (
                        <FileUploadForm onSubmit={handleUploadFile}/>)}
                </div>) : (<button className="add-block-button" onClick={() => setIsCreating(true)}>
                    + Add Block
                </button>)}
            </div>
        </main>

        {notification && <Notification text={notification}/>}
    </div>);
}

function TextBlockForm({onSubmit}) {
    const [content, setContent] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (content.trim()) {
            onSubmit(content);
        }
    };

    return (<form onSubmit={handleSubmit} className="text-block-form">
      <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter your text here..."
          rows={6}
          autoFocus
      />
        <button type="submit">Done</button>
    </form>);
}

function FileUploadForm({onSubmit}) {
    const [file, setFile] = useState(null);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (file) {
            onSubmit(file);
        }
    };

    return (<form onSubmit={handleSubmit} className="file-upload-form">
        <input
            type="file"
            onChange={(e) => setFile(e.target.files[0])}
            required
        />
        {file && (<div className="file-info">
            Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
        </div>)}
        <button type="submit" disabled={!file}>
            Upload
        </button>
    </form>);
}
