import React, {useEffect, useRef, useState} from 'react';
import {motion} from 'motion/react';
import QRCode from 'qrcode';
import {useToast} from '../context/ToastContext';
import {IconButton} from './IconButton';
import {Copy} from './animate-ui/icons/copy';
import {Lock} from './animate-ui/icons/lock';
import {Pencil} from './animate-ui/icons/pencil';
import {X} from './animate-ui/icons/x';
import './Id.css';

function readQrColors() {
    if (typeof document === 'undefined') {
        return {dark: '#0a0a0a', light: '#ffffff'};
    }
    const style = getComputedStyle(document.documentElement);
    const fg = style.getPropertyValue('--fg').trim() || '#0a0a0a';
    const bg = style.getPropertyValue('--bg-elev').trim() || '#ffffff';
    return {dark: fg, light: bg};
}

// No QR glyph in Animate UI; this one stays still and only gets the press.
const IconQr = ({size, ...props}) => (
    <svg xmlns="http://www.w3.org/2000/svg" height={size} viewBox="0 -960 960 960" width={size} fill="currentColor" {...props}>
        <path d="M120-520v-320h320v320H120Zm80-80h160v-160H200v160Zm-80 480v-320h320v320H120Zm80-80h160v-160H200v160Zm320-320v-320h320v320H520Zm80-80h160v-160H600v160Zm160 480v-80h80v80h-80ZM520-360v-80h80v80h-80Zm80 80v-80h80v80h-80Zm-80 80v-80h80v80h-80Zm80 80v-80h80v80h-80Zm80-80v-80h80v80h-80Zm0-160v-80h80v80h-80Zm80 80v-80h80v80h-80Z"/>
    </svg>
);

// The ID is the room's key, so it sits blurred until someone looks: hovering
// shows it, and a press shows it for this long before it clouds over again.
const REVEAL_MS = 20000;

// [what everyone is told, what the host is told]
const LOCK_TITLES = {
    false: ['Private', 'Private — click to list on the home page'],
    true: ['Listed on the home page', 'Listed on the home page — click to hide'],
};
const EDIT_TITLES = {
    false: ['Only the host can edit', 'Only the host can edit — click to let everyone edit'],
    true: ['Everyone can edit', 'Everyone can edit — click to keep it to the host'],
};

export function Id({sessionData, isPublic = false, allowEdit = false, canChange = false, onTogglePublic, onToggleEdit}) {
    const [showQrPopup, setShowQrPopup] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [qrError, setQrError] = useState(false);
    const qrButtonRef = useRef(null);
    const popupRef = useRef(null);
    const toast = useToast();
    const [revealed, setRevealed] = useState(false);
    const revealTimerRef = useRef(null);

    // Pressing again starts the twenty seconds over.
    const reveal = () => {
        setRevealed(true);
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = setTimeout(() => setRevealed(false), REVEAL_MS);
    };
    useEffect(() => () => clearTimeout(revealTimerRef.current), []);

    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

    useEffect(() => {
        if (!showQrPopup) return;
        let cancelled = false;
        setQrDataUrl('');
        setQrError(false);
        const colors = readQrColors();
        QRCode.toDataURL(currentUrl, {width: 240, margin: 1, color: colors})
            .then((url) => {
                if (!cancelled) setQrDataUrl(url);
            })
            .catch((err) => {
                console.error('QR code generation failed:', err);
                if (!cancelled) setQrError(true);
            });
        return () => { cancelled = true; };
    }, [showQrPopup, currentUrl]);

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(currentUrl);
            toast.success('URL copied');
        } catch (err) {
            console.error('Failed to copy URL:', err);
            toast.error('Failed to copy URL');
        }
    };

    const handleToggleQr = () => setShowQrPopup((prev) => !prev);

    useEffect(() => {
        if (!showQrPopup) return undefined;
        const handleClickOutside = (event) => {
            if (
                popupRef.current && !popupRef.current.contains(event.target)
                && qrButtonRef.current && !qrButtonRef.current.contains(event.target)
            ) {
                setShowQrPopup(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showQrPopup]);

    return (
        <div className="id">
            <button type="button" className={`id-code ${revealed ? 'is-revealed' : ''}`} onClick={reveal}>
                <span className="id-code-text">{sessionData?.connection_id}</span>
            </button>
            <IconButton
                icon={Copy}
                size={14}
                className="id-btn"
                onClick={handleCopyUrl}
                aria-label="Copy share URL"
                title="Copy share URL"
            />
            <IconButton
                ref={qrButtonRef}
                icon={IconQr}
                size={14}
                className="id-btn"
                onClick={handleToggleQr}
                aria-label="Show QR code"
                title="Show QR code"
            />
            {/* Two switches, the host's to flip and everyone's to read: who can
                find the room, and who can change it. Each turns green as it
                opens up, its icon opening with it — the shackle springs up, the
                pencil's strike-through draws back. */}
            <motion.button
                type="button"
                className={`id-btn id-switch ${isPublic ? 'is-open' : ''}`}
                onClick={onTogglePublic}
                disabled={!canChange}
                whileTap={canChange ? {scale: 0.9} : undefined}
                aria-pressed={isPublic}
                aria-label={LOCK_TITLES[isPublic][canChange ? 1 : 0]}
                title={LOCK_TITLES[isPublic][canChange ? 1 : 0]}
            >
                <Lock size={14} animate={isPublic ? 'unlock' : false} aria-hidden="true" />
            </motion.button>
            <motion.button
                type="button"
                className={`id-btn id-switch ${allowEdit ? 'is-open' : ''}`}
                onClick={onToggleEdit}
                disabled={!canChange}
                whileTap={canChange ? {scale: 0.9} : undefined}
                aria-pressed={allowEdit}
                aria-label={EDIT_TITLES[allowEdit][canChange ? 1 : 0]}
                title={EDIT_TITLES[allowEdit][canChange ? 1 : 0]}
            >
                <Pencil size={14} animate={allowEdit ? 'unlock' : false} aria-hidden="true" />
            </motion.button>

            {showQrPopup && (
                <div ref={popupRef} className="qr-popup" role="dialog" aria-label="Share QR code">
                    <div className="qr-popup-head">
                        <span className="qr-popup-label">Scan to join</span>
                        <IconButton
                            icon={X}
                            size={16}
                            className="qr-popup-close"
                            onClick={() => setShowQrPopup(false)}
                            aria-label="Close"
                        />
                    </div>
                    <div className="qr-popup-body">
                        {qrDataUrl ? (
                            <img src={qrDataUrl} alt="QR code for share URL" />
                        ) : qrError ? (
                            <div className="qr-popup-err">Failed to render QR</div>
                        ) : (
                            <div className="qr-popup-loading">Generating…</div>
                        )}
                    </div>
                    <p className="qr-popup-url">{currentUrl}</p>
                </div>
            )}
        </div>
    );
}
