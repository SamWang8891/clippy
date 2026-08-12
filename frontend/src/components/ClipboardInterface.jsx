import React, {useCallback, useEffect, useState} from 'react';
import {useSession} from '../context/SessionContext';
import {useToast} from '../context/ToastContext';
import {useConfirm} from '../context/ConfirmContext';
import {useWebSocket} from '../hooks/useWebSocket';
import {
    createTextBlock,
    deleteBlock,
    getSession,
    replaceFileBlock,
    toggleSessionPublic,
    updateTextBlock,
    uploadFileBlock,
} from '../utils/api';
import {clearSessionKey, setSessionKeyFromConnectionId} from '../utils/encryption';
import {SUPPORTED_LANGUAGES, encodeCodeBlock} from '../utils/codeBlock';
import {BlockItem} from './BlockItem';
import {Id} from './Id';
import {Menu} from './Menu';
import {Notification} from './Notification';
import './ClipboardInterface.css';


export function ClipboardInterface() {
    const {sessionData, clearSession} = useSession();
    const toast = useToast();
    const confirm = useConfirm();
    // Our public id — what other members see. sessionData.user_id is the secret
    // token and never appears in the broadcast user list.
    const myPublicId = sessionData?.public_id;
    const [session, setSession] = useState(null);
    const [blocks, setBlocks] = useState([]);
    const [users, setUsers] = useState([]);
    const [showMenu, setShowMenu] = useState(false);
    const [notification, setNotification] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newBlockType, setNewBlockType] = useState('text');
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [pendingUploads, setPendingUploads] = useState(0);

    useEffect(() => {
        if (!sessionData?.connection_id) return;

        let cancelled = false;
        (async () => {
            try {
                await setSessionKeyFromConnectionId(sessionData.connection_id);
            } catch (err) {
                console.error('Failed to install session key:', err);
                clearSessionKey();
            }
            if (cancelled) return;
            await loadSession();
        })();

        // Only normalise the URL when it isn't already pointing at a *different*
        // session. Rewriting unconditionally meant opening someone's invite link
        // while already in a session silently snapped you back to your own.
        const expectedUrl = `/${sessionData.connection_id}`;
        const pathId = window.location.pathname.replace(/^\//, '').trim().toLowerCase();
        const isForeignInvite = pathId && pathId !== sessionData.connection_id;
        if (!isForeignInvite && window.location.pathname !== expectedUrl) {
            window.history.replaceState({}, '', expectedUrl);
        }

        return () => {
            cancelled = true;
            clearSessionKey();
        };
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

    // A dead connection is not a decision the user can help with, so there is
    // nothing to ask: drop it and land on the dashboard.
    const goHome = useCallback(() => {
        clearSession();
        window.history.replaceState({}, '', '/');
        window.location.reload();
    }, [clearSession]);

    useEffect(() => {
        const validateSession = async () => {
            if (!sessionData?.connection_id) return;
            try {
                await getSession(sessionData.connection_id, sessionData.user_id);
            } catch (err) {
                // Only a verdict from the server counts. An offline tab or a
                // failed fetch has no status, and throwing away a session that
                // is still alive would cost the user their blocks.
                if (err.status === 404 || err.status === 403) goHome();
            }
        };

        validateSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleWebSocketMessage = useCallback((message) => {
        switch (message.type) {
            case 'user_joined':
                // Guard against a duplicate if the initial load lands after the
                // event that announced the same user.
                setUsers((prev) => prev.some((u) => u.id === message.user.id)
                    ? prev
                    : [...prev, message.user]);
                showNotification(`${message.user.name} joined`);
                break;

            case 'user_left':
                setUsers((prev) => {
                    const leftUser = prev.find((u) => u.id === message.user_id);
                    if (leftUser) {
                        showNotification(`${leftUser.name} left`);
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

            case 'block_updated':
                setBlocks((prev) => prev.map((b) => b.id === message.block.id ? message.block : b));
                break;

            case 'host_transferred':
                setUsers((prev) => prev.map((u) => ({...u, is_host: u.id === message.new_host_id})));
                setSession((prev) => ({...prev, host_id: message.new_host_id}));
                if (message.new_host_id === myPublicId) {
                    showNotification('You are now the host');
                }
                break;

            case 'join_permission_changed':
                setSession((prev) => ({...prev, allow_join: message.allow_join}));
                break;

            case 'curl_permission_changed':
                setSession((prev) => ({...prev, allow_curl_upload: message.allow_curl_upload}));
                break;

            case 'public_changed':
                setSession((prev) => ({...prev, is_public: message.is_public}));
                break;

            case 'session_destroyed':
                goHome();
                break;
        }
    }, [myPublicId, goHome]);

    // The socket gave up reconnecting — same treatment as an expired session.
    const handleAuthRejected = goHome;

    // Passed by identity into a ref inside the hook, so re-creating it each
    // render only refreshes that ref — it never re-opens the socket.
    const {isConnected} = useWebSocket(
        sessionData?.connection_id,
        sessionData?.user_id,
        handleWebSocketMessage,
        handleAuthRejected,
        loadSession,
    );

    const showNotification = (text) => {
        setNotification(text);
        setTimeout(() => setNotification(null), 3000);
    };

    const handleCreateTextBlock = async (content) => {
        try {
            await createTextBlock(sessionData.connection_id, sessionData.user_id, content);
            setIsCreating(false);
            toast.success('Saved');
        } catch (err) {
            toast.error('Failed to save: ' + err.message);
        }
    };

    const handleUpdateText = async (blockId, content) => {
        try {
            await updateTextBlock(sessionData.connection_id, sessionData.user_id, blockId, content);
            toast.success('Updated');
        } catch (err) {
            toast.error('Failed to update: ' + err.message);
            throw err;
        }
    };

    const handleUploadFile = async (file) => {
        try {
            await uploadFileBlock(sessionData.connection_id, sessionData.user_id, file);
            setIsCreating(false);
            toast.success('Uploaded');
        } catch (err) {
            toast.error('Failed to upload: ' + err.message);
        }
    };

    // Dropped files skip the composer entirely: they upload one after another
    // rather than in parallel, because each one is held in memory whole while
    // it is encrypted.
    const uploadDroppedFiles = useCallback(async (fileList) => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;

        setPendingUploads(files.length);
        let uploaded = 0;
        for (const file of files) {
            try {
                await uploadFileBlock(sessionData.connection_id, sessionData.user_id, file);
                uploaded += 1;
            } catch (err) {
                toast.error(`Failed to upload ${file.name}: ${err.message}`);
            }
            setPendingUploads(files.length - uploaded);
        }
        setPendingUploads(0);
        if (uploaded > 0) {
            toast.success(uploaded === 1 ? 'Uploaded' : `Uploaded ${uploaded} files`);
        }
    }, [sessionData, toast]);

    // Bound to the window, not the layout: a file dropped just outside the card
    // would otherwise be opened by the browser and navigate the session away.
    useEffect(() => {
        const carriesFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
        // dragenter/dragleave fire for every child element, so track depth
        // instead of toggling — otherwise the overlay strobes as the cursor moves.
        let depth = 0;

        const onDragEnter = (e) => {
            if (!carriesFiles(e)) return;
            depth += 1;
            setIsDraggingFiles(true);
        };
        const onDragOver = (e) => {
            if (!carriesFiles(e)) return;
            e.preventDefault();
        };
        const onDragLeave = (e) => {
            if (!carriesFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) setIsDraggingFiles(false);
        };
        const onDrop = (e) => {
            if (!carriesFiles(e)) return;
            e.preventDefault();
            depth = 0;
            setIsDraggingFiles(false);
            uploadDroppedFiles(e.dataTransfer.files);
        };

        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, [uploadDroppedFiles]);

    const handleReplaceFile = async (blockId, file) => {
        try {
            await replaceFileBlock(sessionData.connection_id, sessionData.user_id, blockId, file);
            toast.success('Replaced');
        } catch (err) {
            toast.error('Failed to replace: ' + err.message);
            throw err;
        }
    };

    const handleDeleteBlock = async (blockId) => {
        try {
            await deleteBlock(sessionData.connection_id, sessionData.user_id, blockId);
            toast.success('Deleted');
        } catch (err) {
            toast.error('Failed to delete: ' + err.message);
        }
    };

    const handleToggleVisibility = async () => {
        const next = !session?.is_public;
        try {
            await toggleSessionPublic(sessionData.connection_id, sessionData.user_id, next);
            toast.success(next ? 'Listed on the home page' : 'Private again');
        } catch (err) {
            toast.error('Failed to change visibility: ' + err.message);
        }
    };

    const handleLogoClick = async () => {
        const confirmed = await confirm({
            title: 'Leave connection',
            message: 'Are you sure you want to leave? You will need the connection ID to rejoin.',
            confirmText: 'Leave',
            cancelText: 'Stay',
            confirmStyle: 'danger'
        });

        if (confirmed) {
            clearSession();
            window.history.pushState({}, '', '/');
            window.location.reload();
        }
    };

    const currentUser = users.find((u) => u.id === myPublicId);

    const countLabel = blocks.length === 0
        ? 'No items yet.'
        : blocks.length === 1 ? '1 item' : `${blocks.length} items`;

    return (
        <div className="desk">
            <header className="desk-head">
                <div className="desk-row desk-row-top">
                    <button className="desk-brand" onClick={handleLogoClick} type="button">
                        Clippy
                    </button>

                    <div className="desk-meta">
                        <span className={`desk-status ${isConnected ? 'is-live' : 'is-off'}`}>
                            <span className="desk-status-dot" aria-hidden="true" />
                            {isConnected ? 'Live' : 'Offline'}
                        </span>
                        <button
                            className={`desk-menu-btn ${showMenu ? 'is-open' : ''}`}
                            onClick={() => setShowMenu(!showMenu)}
                            aria-label="Menu"
                            type="button"
                        >
                            <span /><span /><span />
                        </button>
                    </div>
                </div>

                <div className="desk-row desk-row-bot">
                    {currentUser && (
                        <div className="desk-user">
                            <span className="desk-user-name">{currentUser.name}</span>
                            {currentUser.is_host && <span className="desk-host-tag">HOST</span>}
                        </div>
                    )}
                    <div className="desk-id">
                        <Id
                            sessionData={sessionData}
                            isPublic={session?.is_public ?? false}
                            canToggleVisibility={currentUser?.is_host ?? false}
                            onToggleVisibility={handleToggleVisibility}
                        />
                    </div>
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

            <div className="desk-body">
                <div className="desk-count">{countLabel}</div>

                <div className="desk-blocks">
                    {blocks.map((block, idx) => (
                        <BlockItem
                            key={block.id}
                            index={idx}
                            block={block}
                            sessionId={sessionData.connection_id}
                            userId={sessionData.user_id}
                            onDelete={handleDeleteBlock}
                            onUpdateText={handleUpdateText}
                            onReplaceFile={handleReplaceFile}
                        />
                    ))}
                </div>

                {isCreating ? (
                    <div className="compose">
                        <div className="compose-tabs" role="tablist">
                            {[
                                {id: 'text', label: 'Text'},
                                {id: 'code', label: 'Code'},
                                {id: 'file', label: 'File'},
                            ].map((t) => (
                                <button
                                    key={t.id}
                                    role="tab"
                                    aria-selected={newBlockType === t.id}
                                    className={`compose-tab ${newBlockType === t.id ? 'is-active' : ''}`}
                                    onClick={() => setNewBlockType(t.id)}
                                    type="button"
                                >
                                    {t.label}
                                </button>
                            ))}
                            <button
                                className="compose-close"
                                onClick={() => setIsCreating(false)}
                                aria-label="Close composer"
                                type="button"
                            >
                                Close
                            </button>
                        </div>

                        {newBlockType === 'file'
                            ? <FileUploadForm onSubmit={handleUploadFile} />
                            : <TextBlockForm
                                mode={newBlockType}
                                onSubmit={(body, language) => handleCreateTextBlock(
                                    newBlockType === 'code' ? encodeCodeBlock(body, language) : body
                                )}
                            />}
                    </div>
                ) : (
                    <button className="compose-open" onClick={() => setIsCreating(true)} type="button">
                        New item
                    </button>
                )}
            </div>

            {(isDraggingFiles || pendingUploads > 0) && (
                <div className="desk-drop" role="status">
                    <div className="desk-drop-card">
                        {pendingUploads > 0
                            ? `Uploading… ${pendingUploads} left`
                            : 'Drop files to upload'}
                    </div>
                </div>
            )}

            {notification && <Notification text={notification}/>}
        </div>
    );
}

function TextBlockForm({mode = 'text', onSubmit, initialContent = '', initialLanguage = 'auto'}) {
    const [content, setContent] = useState(initialContent);
    const [language, setLanguage] = useState(initialLanguage);

    const isCode = mode === 'code';

    const handleSubmit = (e) => {
        e.preventDefault();
        if (content.trim()) {
            onSubmit(content, language);
        }
    };

    const handleKeyDown = (e) => {
        if (isCode && e.key === 'Tab') {
            e.preventDefault();
            const {selectionStart, selectionEnd, value} = e.target;
            const next = value.substring(0, selectionStart) + '  ' + value.substring(selectionEnd);
            setContent(next);
            requestAnimationFrame(() => {
                e.target.selectionStart = e.target.selectionEnd = selectionStart + 2;
            });
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (content.trim()) onSubmit(content, language);
        }
    };

    const lineCount = Math.max(1, content.split('\n').length);
    const charCount = content.length;

    const placeholder = isCode
        ? '// code'
        : 'Plain text';

    return (
        <form onSubmit={handleSubmit} className={`compose-text ${isCode ? 'is-code' : ''}`}>
            <div className="compose-text-frame">
                <div className="compose-gutter" aria-hidden="true">
                    {Array.from({length: Math.max(10, lineCount)}, (_, i) => (
                        <span key={i}>{String(i + 1).padStart(2, '0')}</span>
                    ))}
                </div>
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={10}
                    autoFocus
                    spellCheck="false"
                />
            </div>
            <div className="compose-foot">
                <div className="compose-stats">
                    <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
                    <span className="compose-dot">·</span>
                    <span>{charCount} chars</span>
                    {isCode && (
                        <>
                            <span className="compose-dot">·</span>
                            <label className="compose-lang">
                                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                                    {SUPPORTED_LANGUAGES.map((l) => (
                                        <option key={l.id} value={l.id}>{l.label}</option>
                                    ))}
                                </select>
                            </label>
                        </>
                    )}
                </div>
                <button type="submit" className="compose-submit" disabled={!content.trim()}>
                    Save
                </button>
            </div>
        </form>
    );
}

export {TextBlockForm};

function FileUploadForm({onSubmit}) {
    const [file, setFile] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file || isUploading) return;
        setIsUploading(true);
        try {
            await onSubmit(file);
        } finally {
            setIsUploading(false);
        }
    };

    // stopPropagation, or the window-level drop handler uploads the file too.
    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (isUploading) return;
        if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
    };

    return (
        <form onSubmit={handleSubmit} className="compose-file">
            <label
                className={`compose-drop ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
            >
                {/* No `required` attribute: the input is visually hidden, so browser
                    constraint validation would block drag-drop submits without any
                    feedback. We enforce "a file is present" via the submit handler. */}
                <input
                    type="file"
                    onChange={(e) => setFile(e.target.files[0] ?? null)}
                    disabled={isUploading}
                />
                {file ? (
                    <div className="compose-drop-info">
                        <span className="compose-drop-name">{file.name}</span>
                        <span className="compose-drop-size">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                ) : (
                    <div className="compose-drop-idle">
                        Drop a file or click to browse
                    </div>
                )}
            </label>
            <div className="compose-foot">
                <div className="compose-stats">
                    {file ? <span>{file.type || 'application/octet-stream'}</span> : <span>&nbsp;</span>}
                </div>
                <button type="submit" className="compose-submit" disabled={!file || isUploading}>
                    {isUploading ? 'Uploading…' : 'Upload'}
                </button>
            </div>
        </form>
    );
}
