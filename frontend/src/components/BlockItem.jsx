import React, {useEffect, useMemo, useRef, useState} from 'react';
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
hljs.registerLanguage('powershell', powershell);
import {useToast} from '../context/ToastContext';
import {decrypt, decryptToBytes} from '../utils/encryption';
import {fetchBlockCiphertext, createRawTextLink, createRawFileLink, getRawLinkUrl} from '../utils/api';
import {SUPPORTED_LANGUAGES, encodeCodeBlock, parseBlockContent} from '../utils/codeBlock';
import {LinedTextarea} from './LinedTextarea';
import {Select} from './Select';
import {IconButton} from './IconButton';
import {Copy} from './animate-ui/icons/copy';
import {Download} from './animate-ui/icons/download';
import {Link} from './animate-ui/icons/link';
import {Pen} from './animate-ui/icons/pen';
import {RefreshCcw} from './animate-ui/icons/refresh-ccw';
import {Trash2} from './animate-ui/icons/trash-2';
import './BlockItem.css';

const CODE_SIGNATURE = /[{};=]|=>|->|^\s*(import|from|const|let|var|def|func|class|function|return|if|for|while|public|private|export)\b|\n\s{2,}\S/m;

// Uploads are stored as opaque ciphertext with no content type, so the file
// name is all there is to go on — and a Blob needs a real type or the browser
// refuses to paint it.
const IMAGE_MIME_BY_EXT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    // No svg: an <img> will not run it, but a member could still open the
    // object URL as a document on this origin, and a preview is not worth
    // leaving that question open.
};
// A thumbnail costs a full download plus a full decrypt in the tab, so past
// this size the download button is the better deal.
const IMAGE_PREVIEW_MAX_BYTES = 12 * 1024 * 1024;
// Start a little before the block is on screen, so scrolling still feels like
// the images were already there.
const PREVIEW_ROOT_MARGIN = '300px';

function imageMimeFor(block) {
    if (block.type !== 'file') return null;
    const name = block.original_filename || block.filename || '';
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return IMAGE_MIME_BY_EXT[ext] ?? null;
}

function looksLikeCode(text) {
    if (!text || text.length < 12) return false;
    return CODE_SIGNATURE.test(text);
}

function highlightExplicit(text, language) {
    if (!language || language === 'auto') return highlightAuto(text);
    try {
        const result = hljs.highlight(text, {language, ignoreIllegals: true});
        return {html: result.value, language: result.language || language};
    } catch {
        return highlightAuto(text);
    }
}

function highlightAuto(text) {
    try {
        const result = hljs.highlightAuto(text, [
            'javascript', 'typescript', 'python', 'go', 'rust', 'java', 'c', 'cpp',
            'bash', 'json', 'yaml', 'xml', 'css', 'sql', 'ruby', 'php', 'kotlin', 'swift', 'markdown'
        ]);
        if (!result.language) return {html: escapeHtml(text), language: 'plaintext'};
        return {html: result.value, language: result.language};
    } catch {
        return {html: escapeHtml(text), language: 'plaintext'};
    }
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
        return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }
    return d.toLocaleDateString([], {month: 'short', day: '2-digit'}) + ' ' +
        d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

// canEdit off means a read-only room: copying and downloading stay, and every
// control that writes is gone — raw links included, since each one is a copy
// counted against the session's storage.
export function BlockItem({block, index, sessionId, userId, canEdit = true, onDelete, onUpdateText, onReplaceFile}) {
    const [decryptedContent, setDecryptedContent] = useState('');
    const [isDecrypting, setIsDecrypting] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [editLanguage, setEditLanguage] = useState('auto');
    const [editMode, setEditMode] = useState('text');
    const [isSaving, setIsSaving] = useState(false);
    const [isReplacing, setIsReplacing] = useState(false);
    const [isGeneratingRaw, setIsGeneratingRaw] = useState(false);
    const [previewUrl, setPreviewUrl] = useState('');
    const [isPreviewVisible, setIsPreviewVisible] = useState(false);
    const articleRef = useRef(null);
    const fileInputRef = useRef(null);
    const toast = useToast();

    useEffect(() => {
        if (block.type !== 'text' || !block.content) return undefined;
        let cancelled = false;
        setIsDecrypting(true);
        decrypt(block.content)
            .then((plaintext) => {
                if (!cancelled) setDecryptedContent(plaintext);
            })
            .catch((err) => {
                console.error('Decrypt failed:', err);
                if (!cancelled) setDecryptedContent('Failed to decrypt content');
            })
            .finally(() => {
                if (!cancelled) setIsDecrypting(false);
            });
        return () => { cancelled = true; };
    }, [block]);

    const imageMime = useMemo(() => imageMimeFor(block), [block]);

    // Previews wait until the block is nearly on screen. Loading every one on
    // mount meant a room full of image blocks downloaded and AES-GCM-decrypted
    // all of them at once — a member could fill a session with them and take
    // every other tab down on join.
    useEffect(() => {
        if (!imageMime || isPreviewVisible) return undefined;
        const element = articleRef.current;
        if (!element || typeof window.IntersectionObserver === 'undefined') {
            setIsPreviewVisible(true);
            return undefined;
        }
        const observer = new window.IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setIsPreviewVisible(true);
                observer.disconnect();
            }
        }, {rootMargin: PREVIEW_ROOT_MARGIN});
        observer.observe(element);
        return () => observer.disconnect();
    }, [imageMime, isPreviewVisible]);

    // Keyed on the block's identity and contents, not the object: every
    // reconnect calls loadSession, which replaces all the block objects, and
    // that re-downloaded and re-decrypted every image on screen.
    useEffect(() => {
        if (!imageMime || !isPreviewVisible || block.size > IMAGE_PREVIEW_MAX_BYTES) return undefined;
        let cancelled = false;
        let objectUrl = '';

        (async () => {
            try {
                const ciphertext = await fetchBlockCiphertext(sessionId, block.id, userId);
                const bytes = await decryptToBytes(ciphertext);
                if (cancelled) return;
                objectUrl = URL.createObjectURL(new Blob([bytes], {type: imageMime}));
                setPreviewUrl(objectUrl);
            } catch (err) {
                console.error('Preview failed:', err);
            }
        })();

        return () => {
            cancelled = true;
            setPreviewUrl('');
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [block.id, block.filename, block.size, imageMime, isPreviewVisible, sessionId, userId]);

    const parsed = useMemo(() => parseBlockContent(decryptedContent), [decryptedContent]);

    const rendered = useMemo(() => {
        if (block.type !== 'text' || isDecrypting) return null;
        if (parsed.format === 'code') {
            return highlightExplicit(parsed.body, parsed.language || 'auto');
        }
        if (looksLikeCode(parsed.body)) {
            const auto = highlightAuto(parsed.body);
            if (auto.language && auto.language !== 'plaintext') return auto;
        }
        return null;
    }, [parsed, block.type, isDecrypting]);

    const lines = parsed.body ? parsed.body.split('\n') : [];

    const handleCopy = () => {
        navigator.clipboard.writeText(parsed.body);
        toast.success('Copied');
    };

    const handleDownload = async () => {
        try {
            const encryptedData = await fetchBlockCiphertext(sessionId, block.id, userId);
            const bytes = await decryptToBytes(encryptedData);

            const blob = new Blob([bytes], {type: 'application/octet-stream'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = block.original_filename || block.filename || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast.success('Downloaded');
        } catch (err) {
            console.error('Download error:', err);
            toast.error('Failed to download');
        }
    };

    const handleStartEdit = () => {
        setEditValue(parsed.body);
        setEditMode(parsed.format);
        setEditLanguage(parsed.language || 'auto');
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditValue('');
    };

    const handleSaveEdit = async () => {
        if (!editValue.trim() || !onUpdateText) return;
        const payload = editMode === 'code'
            ? encodeCodeBlock(editValue, editLanguage)
            : editValue;
        setIsSaving(true);
        try {
            await onUpdateText(block.id, payload);
            setIsEditing(false);
        } catch {
            /* toast handled upstream */
        } finally {
            setIsSaving(false);
        }
    };

    const handlePickReplacement = () => {
        fileInputRef.current?.click();
    };

    const handleReplaceFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !onReplaceFile) return;
        setIsReplacing(true);
        try {
            await onReplaceFile(block.id, file);
        } catch {
            /* toast handled upstream */
        } finally {
            setIsReplacing(false);
        }
    };

    const handleGetRawLink = async () => {
        setIsGeneratingRaw(true);
        try {
            let data;
            if (block.type === 'text') {
                data = await createRawTextLink(sessionId, userId, block.id, parsed.body);
            } else {
                const encryptedData = await fetchBlockCiphertext(sessionId, block.id, userId);
                const bytes = await decryptToBytes(encryptedData);
                const blob = new Blob([bytes], {type: 'application/octet-stream'});
                const originalFilename = block.original_filename || block.filename || 'download';
                data = await createRawFileLink(sessionId, userId, block.id, blob, originalFilename);
            }
            const url = getRawLinkUrl(sessionId, data.code);
            await navigator.clipboard.writeText(url);
            toast.success('Raw link copied');
        } catch (err) {
            console.error('Raw link error:', err);
            toast.error('Failed to create raw link');
        } finally {
            setIsGeneratingRaw(false);
        }
    };

    const handleEditKeyDown = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSaveEdit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            handleCancelEdit();
        }
    };

    const timestamp = formatTime(block.created_at);

    const title = block.type === 'file'
        ? (block.original_filename || block.filename || 'file')
        : rendered ? `code · ${rendered.language}` : 'text';

    return (
        // --i staggers the entrance down the list. The view-transition name is
        // what lets a deletion animate: the browser keeps a snapshot of this
        // block to fade out while the ones below slide up into its place.
        <article
            className="block"
            ref={articleRef}
            style={{'--i': index, viewTransitionName: `block-${block.id}`}}
        >
            <header className="block-head">
                <span className="block-title" title={title}>{title}</span>
                <span className="block-meta">
                    {block.created_by === '__curl__' && (
                        <>
                            <span className="block-curl-tag">curl</span>
                            <span className="block-dot">·</span>
                        </>
                    )}
                    {block.type === 'file' && block.size > 0 && (
                        <>
                            <span>{formatBytes(block.size)}</span>
                            <span className="block-dot">·</span>
                        </>
                    )}
                    <span>{timestamp}</span>
                </span>
            </header>

            <div className="block-content">
                {isEditing ? (
                    <div className="block-edit">
                        <div className="block-edit-tabs">
                            {[
                                {id: 'text', label: 'Text'},
                                {id: 'code', label: 'Code'},
                            ].map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    className={`block-edit-tab ${editMode === opt.id ? 'is-active' : ''}`}
                                    onClick={() => setEditMode(opt.id)}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            {editMode === 'code' && (
                                <Select
                                    className="block-edit-lang"
                                    value={editLanguage}
                                    options={SUPPORTED_LANGUAGES}
                                    onChange={setEditLanguage}
                                    label="Language"
                                />
                            )}
                        </div>
                        <LinedTextarea
                            value={editValue}
                            onChange={setEditValue}
                            code={editMode === 'code'}
                            onKeyDown={handleEditKeyDown}
                            aria-label={editMode === 'code' ? 'Code' : 'Text'}
                            autoFocus
                        />
                        <div className="block-edit-foot">
                            <span className="block-edit-hint">⌘/Ctrl + ↵ save · Esc cancel</span>
                            <div className="block-edit-buttons">
                                <button
                                    type="button"
                                    className="block-btn"
                                    onClick={handleCancelEdit}
                                    disabled={isSaving}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="block-btn is-primary"
                                    onClick={handleSaveEdit}
                                    disabled={isSaving || !editValue.trim()}
                                >
                                    {isSaving ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : block.type === 'text' ? (
                    isDecrypting ? (
                        <div className="block-loading">Decrypting…</div>
                    ) : rendered ? (
                        <pre className="block-code">
                            <code className="block-code-gutter" aria-hidden="true">
                                {lines.map((_, i) => (
                                    <span key={i}>{String(i + 1).padStart(2, '0')}</span>
                                ))}
                            </code>
                            <code
                                className={`hljs language-${rendered.language}`}
                                dangerouslySetInnerHTML={{__html: rendered.html}}
                            />
                        </pre>
                    ) : (
                        <pre className="block-text">{parsed.body}</pre>
                    )
                ) : previewUrl ? (
                    /* An <img> never executes script, so an uploaded SVG stays
                       inert here. Deliberately not a link to the blob: opening
                       one as a document would run it on this origin. */
                    <img className="block-thumb" src={previewUrl} alt={title} />
                ) : null}
            </div>

            {!isEditing && (
                <div className="block-actions">
                    {block.type === 'text' && !isDecrypting && (
                        <>
                            <IconButton
                                icon={Copy}
                                onClick={handleCopy}
                                className="block-action"
                                aria-label="Copy"
                                title="Copy"
                            />
                            {canEdit && (
                                <IconButton
                                    icon={Link}
                                    onClick={handleGetRawLink}
                                    className="block-action"
                                    disabled={isGeneratingRaw}
                                    aria-label="Raw link"
                                    title={isGeneratingRaw ? 'Generating…' : 'Raw link'}
                                />
                            )}
                            {canEdit && onUpdateText && (
                                <IconButton
                                    icon={Pen}
                                    onClick={handleStartEdit}
                                    className="block-action"
                                    aria-label="Edit"
                                    title="Edit"
                                />
                            )}
                        </>
                    )}
                    {block.type === 'file' && (
                        <>
                            <IconButton
                                icon={Download}
                                onClick={handleDownload}
                                className="block-action"
                                aria-label="Download"
                                title="Download"
                            />
                            {canEdit && (
                                <IconButton
                                    icon={Link}
                                    onClick={handleGetRawLink}
                                    className="block-action"
                                    disabled={isGeneratingRaw}
                                    aria-label="Raw link"
                                    title={isGeneratingRaw ? 'Generating…' : 'Raw link'}
                                />
                            )}
                            {canEdit && onReplaceFile && (
                                <>
                                    <IconButton
                                        icon={RefreshCcw}
                                        animation="rotate"
                                        onClick={handlePickReplacement}
                                        className="block-action"
                                        disabled={isReplacing}
                                        aria-label={isReplacing ? 'Uploading' : 'Replace'}
                                        title={isReplacing ? 'Uploading…' : 'Replace'}
                                    />
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        style={{display: 'none'}}
                                        onChange={handleReplaceFile}
                                    />
                                </>
                            )}
                        </>
                    )}
                    {canEdit && (
                        <IconButton
                            icon={Trash2}
                            onClick={() => onDelete(block.id)}
                            className="block-action is-danger"
                            aria-label="Delete"
                            title="Delete"
                        />
                    )}
                </div>
            )}
        </article>
    );
}
