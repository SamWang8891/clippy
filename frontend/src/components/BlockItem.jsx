import React, {useEffect, useMemo, useRef, useState} from 'react';
import hljs from 'highlight.js/lib/common';
import {useToast} from '../context/ToastContext';
import {decrypt, decryptToBytes} from '../utils/encryption';
import {getDownloadUrl, createRawTextLink, createRawFileLink, getRawLinkUrl} from '../utils/api';
import {SUPPORTED_LANGUAGES, encodeCodeBlock, parseBlockContent} from '../utils/codeBlock';
import './BlockItem.css';

const CODE_SIGNATURE = /[{};=]|=>|->|^\s*(import|from|const|let|var|def|func|class|function|return|if|for|while|public|private|export)\b|\n\s{2,}\S/m;

const IconCopy = (props) => (
    <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <rect x="5" y="5" width="8" height="9" rx="1.5" />
        <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v7A1.5 1.5 0 0 0 4.5 12H5" />
    </svg>
);

const IconEdit = (props) => (
    <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d="M11.2 2.8a1.6 1.6 0 0 1 2.3 2.3L5.5 13.1l-3 .7.7-3L11.2 2.8z" />
    </svg>
);

const IconTrash = (props) => (
    <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.3a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.3" />
        <path d="M6.75 7.25v4M9.25 7.25v4" />
    </svg>
);

const IconDownload = (props) => (
    <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7" />
        <path d="M2.75 12.5v.75a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-.75" />
    </svg>
);

const IconReplace = (props) => (
    <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d="M3 6.5A4.5 4.5 0 0 1 11 4M13 9.5A4.5 4.5 0 0 1 5 12" />
        <path d="M11 2v2.5h-2.5M5 14v-2.5h2.5" />
    </svg>
);

const IconRaw = (props) => (
    <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
        <path d="M6.5 9.5a3 3 0 0 0 4.2.4l2-2a3 3 0 0 0-4.2-4.2L7.2 5" />
        <path d="M9.5 6.5a3 3 0 0 0-4.2-.4l-2 2a3 3 0 0 0 4.2 4.2L8.8 11" />
    </svg>
);

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

export function BlockItem({block, sessionId, userId, onDelete, onUpdateText, onReplaceFile}) {
    const [decryptedContent, setDecryptedContent] = useState('');
    const [isDecrypting, setIsDecrypting] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [editLanguage, setEditLanguage] = useState('auto');
    const [editMode, setEditMode] = useState('text');
    const [isSaving, setIsSaving] = useState(false);
    const [isReplacing, setIsReplacing] = useState(false);
    const [isGeneratingRaw, setIsGeneratingRaw] = useState(false);
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
            const response = await fetch(getDownloadUrl(sessionId, block.id, userId));
            if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
            const encryptedData = await response.text();
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
                const response = await fetch(getDownloadUrl(sessionId, block.id, userId));
                if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
                const encryptedData = await response.text();
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
        if (editMode === 'code' && e.key === 'Tab') {
            e.preventDefault();
            const {selectionStart, selectionEnd, value} = e.target;
            const next = value.substring(0, selectionStart) + '  ' + value.substring(selectionEnd);
            setEditValue(next);
            requestAnimationFrame(() => {
                e.target.selectionStart = e.target.selectionEnd = selectionStart + 2;
            });
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSaveEdit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            handleCancelEdit();
        }
    };

    const editLineCount = Math.max(1, editValue.split('\n').length);
    const timestamp = formatTime(block.created_at);

    const title = block.type === 'file'
        ? (block.original_filename || block.filename || 'file')
        : rendered ? `code · ${rendered.language}` : 'text';

    return (
        <article className="block">
            <header className="block-head">
                <span className="block-title" title={title}>{title}</span>
                <span className="block-meta">
                    {block.created_by === '__curl__' && (
                        <>
                            <span className="block-curl-tag">curl</span>
                            <span className="block-dot">·</span>
                        </>
                    )}
                    {block.type === 'file' && block.size != null && (
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
                                <select
                                    className="block-edit-lang"
                                    value={editLanguage}
                                    onChange={(e) => setEditLanguage(e.target.value)}
                                >
                                    {SUPPORTED_LANGUAGES.map((l) => (
                                        <option key={l.id} value={l.id}>{l.label}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <div className="block-edit-frame">
                            <div className="block-edit-gutter" aria-hidden="true">
                                {Array.from({length: Math.max(6, editLineCount)}, (_, i) => (
                                    <span key={i}>{String(i + 1).padStart(2, '0')}</span>
                                ))}
                            </div>
                            <textarea
                                className={`block-edit-input ${editMode === 'code' ? 'is-code' : ''}`}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={handleEditKeyDown}
                                autoFocus
                                spellCheck="false"
                                rows={Math.min(20, Math.max(4, editLineCount))}
                            />
                        </div>
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
                ) : null}
            </div>

            {!isEditing && (
                <div className="block-actions">
                    {block.type === 'text' && !isDecrypting && (
                        <>
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="block-action"
                                aria-label="Copy"
                                title="Copy"
                            >
                                <IconCopy />
                            </button>
                            <button
                                type="button"
                                onClick={handleGetRawLink}
                                className="block-action"
                                disabled={isGeneratingRaw}
                                aria-label="Raw link"
                                title={isGeneratingRaw ? 'Generating…' : 'Raw link'}
                            >
                                <IconRaw />
                            </button>
                            {onUpdateText && (
                                <button
                                    type="button"
                                    onClick={handleStartEdit}
                                    className="block-action"
                                    aria-label="Edit"
                                    title="Edit"
                                >
                                    <IconEdit />
                                </button>
                            )}
                        </>
                    )}
                    {block.type === 'file' && (
                        <>
                            <button
                                type="button"
                                onClick={handleDownload}
                                className="block-action"
                                aria-label="Download"
                                title="Download"
                            >
                                <IconDownload />
                            </button>
                            <button
                                type="button"
                                onClick={handleGetRawLink}
                                className="block-action"
                                disabled={isGeneratingRaw}
                                aria-label="Raw link"
                                title={isGeneratingRaw ? 'Generating…' : 'Raw link'}
                            >
                                <IconRaw />
                            </button>
                            {onReplaceFile && (
                                <>
                                    <button
                                        type="button"
                                        onClick={handlePickReplacement}
                                        className="block-action"
                                        disabled={isReplacing}
                                        aria-label={isReplacing ? 'Uploading' : 'Replace'}
                                        title={isReplacing ? 'Uploading…' : 'Replace'}
                                    >
                                        <IconReplace />
                                    </button>
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
                    <button
                        type="button"
                        onClick={() => onDelete(block.id)}
                        className="block-action is-danger"
                        aria-label="Delete"
                        title="Delete"
                    >
                        <IconTrash />
                    </button>
                </div>
            )}
        </article>
    );
}
