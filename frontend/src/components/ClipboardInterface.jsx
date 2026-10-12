import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AnimatePresence, Reorder, motion} from 'motion/react';
import {useSession} from '../context/SessionContext';
import {useToast} from '../context/ToastContext';
import {useConfirm} from '../context/ConfirmContext';
import {useWebSocket} from '../hooks/useWebSocket';
import {useUndo} from '../hooks/useUndo';
import {
    createTextBlock,
    deleteBlock,
    getSession,
    moveBlock,
    renameSelf,
    replaceFileBlock,
    restoreBlock,
    toggleSessionEdit,
    toggleSessionPublic,
    updateTextBlock,
    uploadFileBlock,
} from '../utils/api';
import {clearSessionKey, decrypt, setSessionKeyFromConnectionId} from '../utils/encryption';
import {SUPPORTED_LANGUAGES, encodeCodeBlock} from '../utils/codeBlock';
import {BlockItem} from './BlockItem';
import {LinedTextarea} from './LinedTextarea';
import {Select} from './Select';
import {IconButton, useIntro} from './IconButton';
import {Layers} from './animate-ui/icons/layers';
import {LoaderCircle} from './animate-ui/icons/loader-circle';
import {Plus} from './animate-ui/icons/plus';
import {Upload} from './animate-ui/icons/upload';
import {Id} from './Id';
import {Menu} from './Menu';
import {Notification} from './Notification';
import {storeName} from './SessionEntry';
import {NO_PASSWORD_MANAGERS} from '../utils/autofill';
import './ClipboardInterface.css';

/**
 * The blocks in `order`. Any it does not mention go last in their current
 * order, so a block that arrived while a drag was under way is never dropped.
 */
function applyOrder(blocks, order) {
    const rank = new Map(order.map((id, i) => [id, i]));
    const ranked = blocks.filter((b) => rank.has(b.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    return [...ranked, ...blocks.filter((b) => !rank.has(b.id))];
}

// The block a block sits right after — what the server takes as its anchor.
const anchorOf = (ids, id) => ids[ids.indexOf(id) - 1] ?? null;

// Brings the composer to the middle of the screen: it opens where the list
// ends, often below the fold. A glide, unless motion is turned down.
function centerInView(node) {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node?.scrollIntoView({behavior: still ? 'auto' : 'smooth', block: 'center'});
}

// The list's height, eased: whatever changes it — a block arriving, leaving,
// decrypting into its full length, opening for an edit — what sits below
// moves smoothly instead of jumping, and the page's end with it, so a scroll
// pinned there follows at the same pace. The frame clips only while it
// moves, starting before the frame paints so a taller list never spills
// over what is below; at rest a block's language list may hang out of it.
// Returns the cleanup.
const EASE = {duration: 260, easing: 'cubic-bezier(0.3, 0, 0.2, 1)'};
function easeListHeight(frame, list, easesRef) {
    let last = list.offsetHeight;
    frame.style.height = `${last}px`;
    const observer = new window.ResizeObserver(() => {
        const to = list.offsetHeight;
        if (to === last) return;
        last = to;
        const from = frame.getBoundingClientRect().height;
        frame.getAnimations().forEach((a) => a.cancel());
        frame.style.height = `${to}px`;
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!easesRef.current || still) return;
        frame.style.overflowY = 'clip';
        frame.animate([{height: `${from}px`}, {height: `${to}px`}], EASE).onfinish = () => {
            frame.style.overflowY = '';
        };
    });
    observer.observe(list);
    return () => observer.disconnect();
}

// The blocks with a restored one back among them, in `order` when given.
function withRestored(blocks, block, order) {
    const all = blocks.some((b) => b.id === block.id) ? blocks : [...blocks, block];
    return order ? applyOrder(all, order) : all;
}

// Keep `heard` if it is newer than the order in `ref`, by the server's move
// count: replies and broadcasts travel separately, so either can land late.
function noteOrder(ref, heard) {
    if (heard.version > ref.current.version) ref.current = {version: heard.version, order: heard.order};
}

const COMPOSE_TABS = [
    {id: 'text', label: 'Text'},
    {id: 'code', label: 'Code'},
    {id: 'file', label: 'File'},
];
// The same snap as the block list: quick, and settled rather than springy.
const QUICK = {duration: 0.18, ease: [0.2, 0, 0, 1]};
// The composer and New item fold into each other: height runs between none
// and the content's own while the content fades. Clipped only while moving,
// as the open composer's language list hangs out of the card; a folding one
// takes no clicks.
const FOLD = {
    folded: {height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none'},
    open: {height: 'auto', opacity: 1, pointerEvents: 'auto', transitionEnd: {overflow: 'visible'}},
};
// Unhurried for a fold, and gentle off the mark: the opening frame also
// mounts the whole composer, and a fast start spent itself in that one frame.
const FOLD_TIMING = {duration: 0.26, ease: [0.3, 0, 0.2, 1]};
// Longer than a fold, in case the composer was gone before a save landed and
// no fold is left to say it has finished.
const HOLD_FALLBACK_MS = 400;



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
    const composeRef = useRef(null);
    // Each opening is a new composer. With one fixed key, reopening during
    // the closing fade made AnimatePresence bring the old card back — a quick
    // Save then N reopened on the text just saved, ready to be saved twice.
    const [composeSession, setComposeSession] = useState(0);
    // A closing card detaches after the new one has attached; only a node
    // arriving may take the ref, or the live composer would lose it.
    const setComposeNode = useCallback((node) => {
        if (node) composeRef.current = node;
    }, []);
    // Whether the open composer holds anything worth asking about; the forms
    // report it, and the outside-press handler below reads it.
    const composeDirtyRef = useRef(false);
    const askingRef = useRef(false);
    // A saved item waits for the composer to fold away before it joins the
    // list, so the card closing and the block arriving do not shove each
    // other about. Only our own new blocks wait, and only while a save of
    // ours is out: null, or the blocks held back.
    const heldBlocksRef = useRef(null);
    const releaseHeldBlocks = useCallback(() => {
        const held = heldBlocksRef.current;
        heldBlocksRef.current = null;
        if (held?.length) setBlocks((prev) => [...prev, ...held.filter((b) => !prev.some((p) => p.id === b.id))]);
    }, []);
    const [newBlockType, setNewBlockType] = useState('text');
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [pendingUploads, setPendingUploads] = useState(0);
    const brandIntro = useIntro(900);

    // Drag handlers run after renders they did not cause; they read the order
    // from here instead of from a stale closure.
    const blocksRef = useRef(blocks);
    const dragAnchorRef = useRef(null);
    // Our moves still on the wire, and the newest order the server has told of.
    // Each broadcast carries the whole order as of its own move, so showing one
    // while later moves of ours were in flight undid them, and the next arrow
    // press started a step behind.
    const pendingMovesRef = useRef(0);
    const newestOrderRef = useRef({version: 0, order: null});
    const undo = useUndo();
    // See easeListHeight; the frame around the list, and what it measures.
    const listFrameRef = useRef(null);
    const listRef = useRef(null);
    // Off until the first load has laid out, so opening a session does not
    // unroll its whole list.
    const listEasesRef = useRef(false);
    useEffect(() => {
        blocksRef.current = blocks;
    }, [blocks]);

    const currentUser = users.find((u) => u.id === myPublicId);
    // Off until the session has loaded, so a read-only room never flashes its
    // composer at a visitor. The server refuses the writes either way.
    const canEdit = Boolean(session) && (session.allow_edit || Boolean(currentUser?.is_host));

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

    useEffect(() => easeListHeight(listFrameRef.current, listRef.current, listEasesRef), []);
    useEffect(() => {
        if (!session) return undefined;
        const timer = setTimeout(() => {
            listEasesRef.current = true;
        }, 300);
        return () => clearTimeout(timer);
    }, [session]);

    const loadSession = async () => {
        try {
            const data = await getSession(sessionData.connection_id, sessionData.user_id);
            setSession(data);
            setUsers(data.users);
            setBlocks(data.blocks);
            newestOrderRef.current = {version: data.order_version, order: null};
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
                if (heldBlocksRef.current && message.block.created_by === myPublicId) {
                    heldBlocksRef.current.push(message.block);
                    break;
                }
                setBlocks((prev) => [...prev, message.block]);
                break;

            case 'block_deleted':
                // AnimatePresence fades it out while the blocks below slide up.
                setBlocks((prev) => prev.filter((b) => b.id !== message.block_id));
                break;

            case 'blocks_reordered': {
                noteOrder(newestOrderRef, message);
                // With moves of ours in flight it waits; persistMove shows the
                // newest order once they have all landed.
                const {order} = newestOrderRef.current;
                if (pendingMovesRef.current === 0 && order) setBlocks((prev) => applyOrder(prev, order));
                break;
            }

            case 'block_updated':
                setBlocks((prev) => prev.map((b) => b.id === message.block.id ? message.block : b));
                break;

            case 'block_restored': {
                // Back in its place in one step, unless moves of ours are out.
                noteOrder(newestOrderRef, message);
                const order = pendingMovesRef.current === 0 ? newestOrderRef.current.order : null;
                setBlocks((prev) => withRestored(prev, message.block, order));
                break;
            }

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

            case 'edit_permission_changed':
                setSession((prev) => ({...prev, allow_edit: message.allow_edit}));
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
    const {isConnected, hasSettled} = useWebSocket(
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

    const openComposer = () => {
        setComposeSession((n) => n + 1);
        setIsCreating(true);
    };


    const closeComposer = () => {
        composeDirtyRef.current = false;
        setIsCreating(false);
    };

    const reportComposeDirty = useCallback((dirty) => {
        composeDirtyRef.current = dirty;
    }, []);

    // Esc puts an empty composer away, as Cancel does, and leaves focus on New
    // item so Enter or N brings it straight back. With something in it Esc does
    // nothing — a stray press must not throw work away. A key the language
    // picker already used (closing its list) or an IME's own Esc is not ours.
    const handleComposeKeyDown = (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return;
        if (composeDirtyRef.current) return;
        e.preventDefault();
        closeComposer();
        requestAnimationFrame(() => document.querySelector('.compose-open')?.focus());
    };

    // A press anywhere outside the composer puts it away: at once when it is
    // empty, after asking when it holds unsaved work. Scrollbars, toasts, drag
    // grips and the question itself do not count as outside.
    //
    // mousedown rather than pointerdown: a phone fires it only for a tap, so
    // scrolling the page does not count as a press. When the press asks, it is
    // claimed whole — preventDefault keeps it from moving focus off the dialog
    // it just opened, and the click it would become is swallowed, so the button
    // under the pointer does not fire behind the question.
    //
    // Armed only while the composer is on screen. A room turned read-only
    // hides it with isCreating still set, and the next press anywhere asked to
    // discard a draft nobody could see — and swallowed the click.
    useEffect(() => {
        if (!isCreating || !canEdit) return undefined;
        let swallowClick = false;
        const onMouseDown = async (e) => {
            swallowClick = false;
            if (e.button !== 0 || askingRef.current) return;
            const target = e.target;
            if (composeRef.current?.contains(target) || target === document.documentElement) return;
            if (target.closest?.('.toast-container, .confirm-dialog, .confirm-overlay, .block-handle')) return;
            if (!composeDirtyRef.current) {
                closeComposer();
                return;
            }
            e.preventDefault();
            swallowClick = true;
            askingRef.current = true;
            const discard = await confirm({
                title: 'Discard draft',
                message: 'This item has not been saved. Discard it?',
                confirmText: 'Discard',
                cancelText: 'Keep editing',
                confirmStyle: 'danger',
            });
            askingRef.current = false;
            if (discard) {
                closeComposer();
            } else {
                // After the dialog has handed focus back, not before — and not
                // at all if another question has taken its place.
                requestAnimationFrame(() => {
                    if (document.querySelector('.confirm-dialog')) return;
                    composeRef.current?.querySelector('textarea, input[type="file"]')?.focus();
                });
            }
        };
        const onClick = (e) => {
            if (!swallowClick) return;
            swallowClick = false;
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('click', onClick, true);
        return () => {
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('click', onClick, true);
        };
    }, [isCreating, canEdit, confirm]);

    // N opens a new item from anywhere the key is not already text: not in a
    // field or the language picker, not mid-composition, not under a dialog.
    // With the composer open it just puts focus back in it. preventDefault, or
    // the n would land in the editor it has just opened.
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key?.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
            if (!canEdit) return;
            if (e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"]')) return;
            if (document.querySelector('.confirm-dialog, .menu-panel, .qr-popup')) return;
            e.preventDefault();
            if (!isCreating) {
                openComposer();
                return;
            }
            composeRef.current?.querySelector('textarea, input[type="file"]')?.focus({preventScroll: true});
            centerInView(composeRef.current);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [canEdit, isCreating]);

    // Holds our new block back until the composer has folded; see
    // heldBlocksRef. Rethrown so the form knows to offer its button again.
    const saveThenFold = async (save, failure) => {
        heldBlocksRef.current = heldBlocksRef.current ?? [];
        try {
            await save();
        } catch (err) {
            releaseHeldBlocks();
            toast.error(failure + err.message);
            throw err;
        }
        closeComposer();
        setTimeout(releaseHeldBlocks, HOLD_FALLBACK_MS);
    };

    const handleCreateTextBlock = async (content) => {
        await saveThenFold(() => createTextBlock(sessionData.connection_id, sessionData.user_id, content), 'Failed to save: ');
        toast.success('Saved');
    };

    const handleUpdateText = async (blockId, content) => {
        const before = blocksRef.current.find((b) => b.id === blockId)?.content;
        try {
            await updateTextBlock(sessionData.connection_id, sessionData.user_id, blockId, content);
            toast.success('Updated');
        } catch (err) {
            toast.error('Failed to update: ' + err.message);
            throw err;
        }
        if (before) {
            undo.record('Updated', async () => updateTextBlock(
                sessionData.connection_id, sessionData.user_id, blockId, await decrypt(before)));
        }
    };

    const handleUploadFile = async (file) => {
        await saveThenFold(() => uploadFileBlock(sessionData.connection_id, sessionData.user_id, file), 'Failed to upload: ');
        toast.success('Uploaded');
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

    // The order is shown at once. When the last move in flight lands, the
    // newest order the server has told of is shown: ours, unless someone else
    // moved something meanwhile. A refused move reloads the server's. A move
    // the user made can be taken back to `from`, the block it sat after; one
    // that takes something back cannot.
    const persistMove = async (blockId, afterId, from) => {
        pendingMovesRef.current += 1;
        let moved = false;
        try {
            noteOrder(newestOrderRef, await moveBlock(sessionData.connection_id, sessionData.user_id, blockId, afterId));
            moved = true;
        } catch (err) {
            toast.error('Failed to move: ' + err.message);
            loadSession();
        } finally {
            pendingMovesRef.current -= 1;
        }
        const {order} = newestOrderRef.current;
        if (pendingMovesRef.current === 0 && order) setBlocks((prev) => applyOrder(prev, order));
        if (moved && from !== undefined) undo.record('Moved', () => placeBlock(blockId, from));
    };

    // Puts a block straight after `afterId`, or first, as a step back does.
    const placeBlock = (blockId, afterId) => {
        const next = blocksRef.current.map((b) => b.id).filter((id) => id !== blockId);
        next.splice(afterId ? next.indexOf(afterId) + 1 : 0, 0, blockId);
        setBlocks((prev) => applyOrder(prev, next));
        return persistMove(blockId, afterId);
    };

    // Reorder calls this on every swap mid-drag; only the drop is sent.
    const handleReorder = (ids) => setBlocks((prev) => applyOrder(prev, ids));

    const handleDragStart = (blockId) => {
        dragAnchorRef.current = anchorOf(blocksRef.current.map((b) => b.id), blockId);
    };

    const handleDragEnd = (blockId) => {
        const anchor = anchorOf(blocksRef.current.map((b) => b.id), blockId);
        if (anchor !== dragAnchorRef.current) persistMove(blockId, anchor, dragAnchorRef.current);
    };

    const handleMoveBy = (blockId, delta) => {
        const ids = blocksRef.current.map((b) => b.id);
        const to = ids.indexOf(blockId) + delta;
        if (to < 0 || to >= ids.length) return;
        const next = ids.filter((id) => id !== blockId);
        next.splice(to, 0, blockId);
        setBlocks((prev) => applyOrder(prev, next));
        persistMove(blockId, anchorOf(next, blockId), anchorOf(ids, blockId));
    };

    const handleDeleteBlock = async (blockId) => {
        try {
            await deleteBlock(sessionData.connection_id, sessionData.user_id, blockId);
            toast.success('Deleted');
        } catch (err) {
            toast.error('Failed to delete: ' + err.message);
            return;
        }
        undo.record('Deleted', async () => {
            const data = await restoreBlock(sessionData.connection_id, sessionData.user_id, blockId);
            noteOrder(newestOrderRef, data);
            setBlocks((prev) => withRestored(prev, data.block, pendingMovesRef.current === 0 ? data.order : null));
        });
    };

    // One step back: the newest change undone, and the clock held so the
    // next press can follow. Nothing on screen speaks of undo, a failure
    // included; the change itself, or its absence, is the answer.
    const stepBack = async () => {
        const step = undo.takeBack();
        if (!step) return;
        try {
            await step.undo();
        } catch (err) {
            console.error('Undo failed:', err);
        }
    };

    // Cmd/Ctrl+Z outside a field steps back; a field keeps its own undo, and
    // a question on screen comes first. Held down, it does not run away.
    useEffect(() => {
        const onKeyDown = (e) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key?.toLowerCase() !== 'z') return;
            if (e.repeat || e.isComposing || !canEdit || !undo.step) return;
            if (e.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
            if (document.querySelector('.confirm-dialog')) return;
            e.preventDefault();
            stepBack();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });

    const handleTogglePublic = async () => {
        const next = !session?.is_public;
        try {
            await toggleSessionPublic(sessionData.connection_id, sessionData.user_id, next);
            toast.success(next ? 'Listed on the home page' : 'Private again');
        } catch (err) {
            toast.error('Failed to change visibility: ' + err.message);
        }
    };

    const handleToggleEdit = async () => {
        const next = !session?.allow_edit;
        try {
            await toggleSessionEdit(sessionData.connection_id, sessionData.user_id, next);
            toast.success(next ? 'Everyone can edit' : 'Only the host can edit');
        } catch (err) {
            toast.error('Failed to change who can edit: ' + err.message);
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
        <div className={`desk ${isCreating && canEdit ? 'is-composing' : ''}`}>
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
                        {/* Held invisible, in place, until the first connection
                            attempt settles — a refresh flashed "Offline" first. */}
                        <span className={`desk-status ${isConnected ? 'is-live' : 'is-off'} ${hasSettled ? '' : 'is-pending'}`}>
                            <span className="desk-status-dot" aria-hidden="true" />
                            {isConnected ? 'Live' : 'Offline'}
                        </span>
                        <button
                            className={`desk-menu-btn ${showMenu ? 'is-open' : ''}`}
                            onClick={() => setShowMenu(!showMenu)}
                            aria-label="Settings"
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
                            isPublic={session?.is_public ?? false}
                            allowEdit={session?.allow_edit ?? false}
                            canChange={currentUser?.is_host ?? false}
                            onTogglePublic={handleTogglePublic}
                            onToggleEdit={handleToggleEdit}
                        />
                    </div>
                </div>
            </header>

            <AnimatePresence>
                {showMenu && (
                    <Menu
                        key="settings"
                        session={session}
                        users={users}
                        currentUser={currentUser}
                        onClose={() => setShowMenu(false)}
                    />
                )}
            </AnimatePresence>

            <div className="desk-body">
                {/* Until the first load answers, a spinner holds the place of the
                    count and the list, instead of a brief "No items yet." */}
                {session ? (
                    <div className="desk-count">{countLabel}</div>
                ) : (
                    <div className="desk-loading" role="status" aria-label="Loading">
                        <LoaderCircle size={20} animate aria-hidden="true" />
                    </div>
                )}

                <div className="desk-blocks-frame" ref={listFrameRef}>
                <div ref={listRef}>
                <Reorder.Group
                    as="div"
                    axis="y"
                    className="desk-blocks"
                    values={blocks.map((b) => b.id)}
                    onReorder={handleReorder}
                >
                    {/* popLayout takes a deleted block out of the flow at once,
                        so the ones below start sliding up while it fades. */}
                    <AnimatePresence initial={false} mode="popLayout">
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
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                                onMoveBy={handleMoveBy}
                            />
                        ))}
                    </AnimatePresence>
                </Reorder.Group>
                </div>
                </div>

                {/* Whichever way the composer closes — Cancel, Esc, a press
                    outside, Save — it folds down as New item unfolds, and
                    opening is the same move in reverse, so the height below
                    the list runs smoothly instead of being cut. When the list
                    above grows, its frame eases the slot down. */}
                <div className="compose-slot">
                <AnimatePresence initial={false} onExitComplete={releaseHeldBlocks}>
                {!canEdit ? null : isCreating ? (
                    <motion.div
                        key={`compose-${composeSession}`}
                        variants={FOLD}
                        initial="folded"
                        animate="open"
                        exit="folded"
                        transition={FOLD_TIMING}
                        // Unfolded, it can be brought to mid-screen at its full height.
                        onAnimationComplete={(name) => {
                            if (name === 'open') centerInView(composeRef.current);
                        }}
                    >
                    {/* layout animates the card's height between forms; the
                        children ride along by position, so text never squashes. */}
                    <motion.div
                        className="compose"
                        ref={setComposeNode}
                        layout
                        transition={QUICK}
                        style={{borderRadius: 8}}
                        onKeyDown={handleComposeKeyDown}
                    >
                        <motion.div className="compose-tabs" role="tablist" layout="position">
                            {COMPOSE_TABS.map((t) => (
                                <motion.button
                                    key={t.id}
                                    role="tab"
                                    aria-selected={newBlockType === t.id}
                                    className={`compose-tab ${newBlockType === t.id ? 'is-active' : ''}`}
                                    // A mouse press leaves focus in the editor, so typing
                                    // straight after switching modes is not lost.
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setNewBlockType(t.id)}
                                    whileTap={{scale: 0.97}}
                                    type="button"
                                >
                                    {/* One highlight that slides to the chosen tab. */}
                                    {newBlockType === t.id && (
                                        <motion.span layoutId="compose-tab-pill" className="tab-pill" transition={QUICK} />
                                    )}
                                    <span className="tab-label">{t.label}</span>
                                </motion.button>
                            ))}
                        </motion.div>

                        {/* Text and Code share one form, so switching between them
                            keeps what was typed; File swaps the form out, the old
                            one fading over the new while the card resizes. */}
                        <AnimatePresence mode="popLayout" initial={false}>
                            <motion.div
                                key={newBlockType === 'file' ? 'file' : 'text'}
                                layout="position"
                                initial={{opacity: 0, y: 6}}
                                animate={{opacity: 1, y: 0}}
                                exit={{opacity: 0, y: -4}}
                                transition={QUICK}
                            >
                                {newBlockType === 'file'
                                    ? <FileUploadForm
                                        onSubmit={handleUploadFile}
                                        onCancel={closeComposer}
                                        onDirtyChange={reportComposeDirty}
                                    />
                                    : <TextBlockForm
                                        mode={newBlockType}
                                        onSubmit={(body, language) => handleCreateTextBlock(
                                            newBlockType === 'code' ? encodeCodeBlock(body, language) : body
                                        )}
                                        onCancel={closeComposer}
                                        onDirtyChange={reportComposeDirty}
                                    />}
                            </motion.div>
                        </AnimatePresence>
                    </motion.div>
                    </motion.div>
                ) : (
                    <motion.div key="open" variants={FOLD} initial="folded" animate="open" exit="folded" transition={FOLD_TIMING}>
                        <IconButton
                            icon={Plus}
                            size={20}
                            className="compose-open"
                            onClick={openComposer}
                            aria-keyshortcuts="N"
                        >
                            New item
                            {/* aria-hidden: aria-keyshortcuts already says it. */}
                            <kbd className="compose-open-key" aria-hidden="true">N</kbd>
                        </IconButton>
                    </motion.div>
                )}
                </AnimatePresence>
                </div>
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
            {...NO_PASSWORD_MANAGERS}
            aria-label="Name"
            autoFocus
        />
    );
}

function TextBlockForm({mode = 'text', onSubmit, onCancel, onDirtyChange, initialContent = '', initialLanguage = 'auto'}) {
    const [content, setContent] = useState(initialContent);
    const [language, setLanguage] = useState(initialLanguage);
    // Held from the first press until the save fails or the composer goes:
    // a second Save or Cmd+Enter while the first was out posted it twice, and
    // a closing card still takes keys for the length of its fade.
    const [isSaving, setIsSaving] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        onDirtyChange?.(Boolean(content.trim()));
    }, [content, onDirtyChange]);

    // Switching Text/Code or picking a language is a click on a button, which
    // takes focus with it — and the next keystrokes landed on that button.
    // This is also what focuses a fresh composer; the desk scrolls it in.
    useEffect(() => {
        inputRef.current?.focus({preventScroll: true});
    }, [mode]);

    const isCode = mode === 'code';

    const save = async () => {
        if (!content.trim() || isSaving) return;
        setIsSaving(true);
        try {
            await onSubmit(content, language);
        } catch {
            setIsSaving(false);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        save();
    };

    const handleKeyDown = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            save();
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
                inputRef={inputRef}
                value={content}
                onChange={setContent}
                code={isCode}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                aria-label={isCode ? 'Code' : 'Text'}
            />
            <div className="compose-foot">
                <div className="compose-stats">
                    <span>{lineCount} line{lineCount === 1 ? '' : 's'}</span>
                    <span className="compose-dot">·</span>
                    <span>{charCount} chars</span>
                    <AnimatePresence initial={false}>
                        {isCode && (
                            <motion.span
                                key="language"
                                className="compose-lang"
                                initial={{opacity: 0, x: -6}}
                                animate={{opacity: 1, x: 0}}
                                exit={{opacity: 0, x: -6}}
                                transition={QUICK}
                            >
                                <span className="compose-dot">·</span>
                                <Select
                                    value={language}
                                    options={SUPPORTED_LANGUAGES}
                                    onChange={(next) => {
                                        setLanguage(next);
                                        inputRef.current?.focus();
                                    }}
                                    label="Language"
                                />
                            </motion.span>
                        )}
                    </AnimatePresence>
                </div>
                <div className="compose-actions">
                    <button type="button" className="compose-cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="submit" className="compose-submit" disabled={!content.trim() || isSaving}>
                        Save
                    </button>
                </div>
            </div>
        </form>
    );
}

export {TextBlockForm};

function FileUploadForm({onSubmit, onCancel, onDirtyChange}) {
    const [file, setFile] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        onDirtyChange?.(Boolean(file));
    }, [file, onDirtyChange]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file || isUploading) return;
        setIsUploading(true);
        try {
            await onSubmit(file);
        } catch {
            setIsUploading(false);  // as for text, only a failure offers it again
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
                <div className="compose-actions">
                    <button type="button" className="compose-cancel" onClick={onCancel} disabled={isUploading}>
                        Cancel
                    </button>
                    <button type="submit" className="compose-submit" disabled={!file || isUploading}>
                        {isUploading ? 'Uploading…' : 'Upload'}
                    </button>
                </div>
            </div>
        </form>
    );
}
