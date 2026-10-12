import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useSession} from '../context/SessionContext';
import {useToast} from '../context/ToastContext';
import {useConfirm} from '../context/ConfirmContext';
import {useWebSocket} from '../hooks/useWebSocket';
import {
    createTextBlock,
    deleteBlock,
    getSession,
    renameSelf,
    replaceFileBlock,
    setSessionVisibility,
    updateTextBlock,
    uploadFileBlock,
} from '../utils/api';
import {clearSessionKey, setSessionKeyFromConnectionId} from '../utils/encryption';
import {viewTransition} from '../utils/motion';
import {SUPPORTED_LANGUAGES, encodeCodeBlock} from '../utils/codeBlock';
import {BlockItem} from './BlockItem';
import {LinedTextarea} from './LinedTextarea';
import {Select} from './Select';
import {IconButton, useIntro} from './IconButton';
import {Layers} from './animate-ui/icons/layers';
import {Plus} from './animate-ui/icons/plus';
import {Upload} from './animate-ui/icons/upload';
import {Id} from './Id';
import {Menu} from './Menu';
import {Notification} from './Notification';
import {storeName} from './SessionEntry';
import './ClipboardInterface.css';

const NEXT_VISIBILITY = {private: 'public_read', public_read: 'public_edit', public_edit: 'private'};
const VISIBILITY_TOASTS = {
    private: 'Private again',
    public_read: 'Listed on the home page, read-only',
    public_edit: 'Listed on the home page, editable',
};


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
    const brandIntro = useIntro(900);

    const currentUser = users.find((u) => u.id === myPublicId);
    // Off until the session has loaded, so a read-only room never flashes its
    // composer at a visitor. The server refuses the writes either way.
    const canEdit = Boolean(session) && (session.visibility !== 'public_read' || Boolean(currentUser?.is_host));

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

    // 403 means this member was evicted, not that the room is gone — the server
    // drops a user ten seconds after their socket does. Keep the path so the
    // reload rejoins from the URL instead of stranding them on an empty
    // dashboard with the ID no longer written anywhere.
    const rejoinFromUrl = useCallback(() => {
        clearSession();
        window.location.reload();
    }, [clearSession]);

    // Acting on a failed request means deciding whether the session still
    // exists. Only the server can say; a request that never landed says nothing,
    // and treating it as a verdict throws away a live session and its blocks.
    const leaveOnServerVerdict = useCallback((err) => {
        if (err?.status === 404) goHome();
        else if (err?.status === 403) rejoinFromUrl();
    }, [goHome, rejoinFromUrl]);

    useEffect(() => {
        const validateSession = async () => {
            if (!sessionData?.connection_id) return;
            try {
                await getSession(sessionData.connection_id, sessionData.user_id);
            } catch (err) {
                leaveOnServerVerdict(err);
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

            case 'user_renamed':
                setUsers((prev) => prev.map((u) => u.id === message.user_id ? {...u, name: message.name} : u));
                break;

            case 'block_created':
                setBlocks((prev) => [...prev, message.block]);
                break;

            case 'block_deleted':
                // The only change here that removes something, so it is the only
                // one worth a transition: the block fades out while the list
                // closes the gap instead of everything below jumping up.
                viewTransition(() => setBlocks((prev) => prev.filter((b) => b.id !== message.block_id)));
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

            case 'visibility_changed':
                setSession((prev) => ({...prev, visibility: message.visibility}));
                break;

            case 'session_destroyed':
                goHome();
                break;
        }
    }, [myPublicId, goHome]);

    // The socket gave up reconnecting. That looks identical whether the server
    // turned us away or the handshake never got out of the building — a proxy
    // conn-limit, captive wifi, a sleeping laptop — so ask over HTTP before
    // acting. Without this, roughly fifteen seconds offline silently deleted
    // the stored session, and anyone able to exhaust the per-IP WebSocket
    // slots could log a neighbour out on demand.
    const handleSocketGaveUp = useCallback(async () => {
        try {
            await getSession(sessionData.connection_id, sessionData.user_id);
            window.location.reload();  // still ours — start the socket over
        } catch (err) {
            leaveOnServerVerdict(err);  // no status: stay put, badge reads Offline
        }
    }, [sessionData, leaveOnServerVerdict]);

    // Passed by identity into a ref inside the hook, so re-creating it each
    // render only refreshes that ref — it never re-opens the socket.
    const {isConnected} = useWebSocket(
        sessionData?.connection_id,
        sessionData?.user_id,
        handleWebSocketMessage,
        handleSocketGaveUp,
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

        // Counted as a delta, not assigned: a second drop while the first batch
        // is still running would otherwise set the total from its own list and
        // then zero it, hiding the overlay with uploads still in flight.
        setPendingUploads((n) => n + files.length);
        let uploaded = 0;
        for (const file of files) {
            try {
                await uploadFileBlock(sessionData.connection_id, sessionData.user_id, file);
                uploaded += 1;
            } catch (err) {
                toast.error(`Failed to upload ${file.name}: ${err.message}`);
            }
            setPendingUploads((n) => Math.max(0, n - 1));
        }
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

        // A read-only member still has the drop swallowed — the browser would
        // otherwise open the file in place of the session — but is offered no
        // overlay and given a "not allowed" cursor.
        const onDragEnter = (e) => {
            if (!carriesFiles(e) || !canEdit) return;
            depth += 1;
            setIsDraggingFiles(true);
        };
        const onDragOver = (e) => {
            if (!carriesFiles(e)) return;
            e.preventDefault();
            if (!canEdit) e.dataTransfer.dropEffect = 'none';
        };
        const onDragLeave = (e) => {
            if (!carriesFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) setIsDraggingFiles(false);
        };
        const onDrop = (e) => {
            if (!carriesFiles(e)) return;
            // Always reset first. A drop fires no matching dragleave, so this is
            // the only place depth can return to zero — bailing out before it
            // left the overlay painted over the page until a reload.
            depth = 0;
            setIsDraggingFiles(false);
            // The composer's own drop zone runs first and calls preventDefault.
            // That is how it claims the file; uploading here too would post it
            // twice.
            if (e.defaultPrevented) return;
            e.preventDefault();
            if (canEdit) uploadDroppedFiles(e.dataTransfer.files);
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
    }, [uploadDroppedFiles, canEdit]);

    // Ctrl+V lands the same place a drop does. Also window-bound: a screenshot
    // pasted with nothing focused has no other handler to reach.
    useEffect(() => {
        const onPaste = (e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length === 0 || !canEdit) return;
            // Word and Excel put a bitmap on the clipboard next to the text.
            // With the caret in a field, the text is what was meant.
            const editable = e.target?.closest?.('input, textarea, [contenteditable]');
            if (editable && e.clipboardData.getData('text')) return;
            e.preventDefault();
            uploadDroppedFiles(files);
        };

        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [uploadDroppedFiles, canEdit]);

    // Shown at once and corrected by the reply, which may carry a suffix if
    // someone else already holds the name. Remembered for the entry form too,
    // so a rejoin after a dropped connection keeps it.
    const handleRename = async (name) => {
        const previous = users.find((u) => u.id === myPublicId)?.name;
        const setMine = (next) => setUsers((prev) => prev.map((u) => u.id === myPublicId ? {...u, name: next} : u));
        setMine(name);
        storeName(name);
        try {
            const data = await renameSelf(sessionData.connection_id, sessionData.user_id, name);
            setMine(data.user_name);
        } catch (err) {
            setMine(previous);
            toast.error('Failed to rename: ' + err.message);
        }
    };

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

    // Each press opens the room one step further, then closes it again.
    const handleCycleVisibility = async () => {
        const next = NEXT_VISIBILITY[session?.visibility ?? 'private'];
        try {
            await setSessionVisibility(sessionData.connection_id, sessionData.user_id, next);
            toast.success(VISIBILITY_TOASTS[next]);
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

        // goHome, not pushState: leaving used to push a history entry, so Back
        // returned to /<id> — and now that the path decides what is open, that
        // silently rejoined the connection the user had just left.
        if (confirmed) goHome();
    };

    const countLabel = blocks.length === 0
        ? 'No items yet.'
        : blocks.length === 1 ? '1 item' : `${blocks.length} items`;

    return (
        <div className="desk">
            <header className="desk-head">
                <div className="desk-row desk-row-top">
                    <IconButton
                        icon={Layers}
                        animate={brandIntro && 'default-loop'}
                        className="desk-brand"
                        onClick={handleLogoClick}
                    >
                        Clippy
                    </IconButton>

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
                            <NameEditor name={currentUser.name} onRename={handleRename} />
                            {currentUser.is_host && <span className="desk-host-tag">HOST</span>}
                            {session && !canEdit && <span className="desk-host-tag">READ-ONLY</span>}
                        </div>
                    )}
                    <div className="desk-id">
                        <Id
                            sessionData={sessionData}
                            visibility={session?.visibility ?? 'private'}
                            canChangeVisibility={currentUser?.is_host ?? false}
                            onChangeVisibility={handleCycleVisibility}
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
                            canEdit={canEdit}
                            onDelete={handleDeleteBlock}
                            onUpdateText={handleUpdateText}
                            onReplaceFile={handleReplaceFile}
                        />
                    ))}
                </div>

                {!canEdit ? null : isCreating ? (
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
                    <IconButton
                        icon={Plus}
                        size={20}
                        className="compose-open"
                        onClick={() => setIsCreating(true)}
                    >
                        New item
                    </IconButton>
                )}
            </div>

            {(isDraggingFiles || pendingUploads > 0) && (
                <div className="desk-drop" role="status">
                    <div className="desk-drop-card">
                        <Upload size={18} animate="default-loop" loop aria-hidden="true" />
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

/**
 * Your own name, editable in place. Enter or leaving the field saves — on a
 * phone the keyboard's own dismiss is the natural way out — and Esc backs out.
 * A cleared field counts as no edit at all.
 */
function NameEditor({name, onRename}) {
    const [draft, setDraft] = useState(null);
    const cancelledRef = useRef(false);

    if (draft === null) {
        return (
            <button
                type="button"
                className="desk-user-name"
                onClick={() => setDraft(name)}
                aria-label={`Rename ${name}`}
            >
                {name}
            </button>
        );
    }

    const finish = () => {
        const next = draft.trim();
        const cancelled = cancelledRef.current;
        cancelledRef.current = false;
        setDraft(null);
        if (!cancelled && next && next !== name) onRename(next);
    };

    const handleKeyDown = (e) => {
        // An IME uses Enter to accept a composition; that is not a save.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            cancelledRef.current = true;
            e.currentTarget.blur();
        }
    };

    return (
        <input
            className="desk-user-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finish}
            onKeyDown={handleKeyDown}
            onFocus={(e) => e.target.select()}
            size={Math.max(4, draft.length + 1)}
            maxLength={64}
            enterKeyHint="done"
            spellCheck="false"
            autoComplete="off"
            aria-label="Name"
            autoFocus
        />
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
            <LinedTextarea
                value={content}
                onChange={setContent}
                code={isCode}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                aria-label={isCode ? 'Code' : 'Text'}
                autoFocus
            />
            <div className="compose-foot">
                <div className="compose-stats">
                    <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
                    <span className="compose-dot">·</span>
                    <span>{charCount} chars</span>
                    {isCode && (
                        <>
                            <span className="compose-dot">·</span>
                            <Select
                                value={language}
                                options={SUPPORTED_LANGUAGES}
                                onChange={setLanguage}
                                label="Language"
                            />
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

    // preventDefault, not stopPropagation: the window handler reads
    // defaultPrevented to know this drop is already claimed, and it still needs
    // the event so it can put its own overlay away.
    const handleDrop = (e) => {
        e.preventDefault();
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
                        <Upload size={22} animate={dragging} aria-hidden="true" />
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
