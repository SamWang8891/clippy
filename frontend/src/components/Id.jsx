import React, {useEffect, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {useToast} from '../context/ToastContext';
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

// Body plus shackle: closed sits square on the box, open swings clear of it.
const IconLock = ({open}) => (
    <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.5" />
        {open
            ? <path d="M5.75 7V4.9a2.4 2.4 0 0 1 4.75-.5" />
            : <path d="M5.75 7V4.9a2.4 2.4 0 0 1 4.8 0V7" />}
    </svg>
);

export function Id({sessionData, isPublic = false, canToggleVisibility = false, onToggleVisibility}) {
    const [showQrPopup, setShowQrPopup] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [qrError, setQrError] = useState(false);
    const qrButtonRef = useRef(null);
    const popupRef = useRef(null);
    const toast = useToast();

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
            <span className="id-code">{sessionData?.connection_id}</span>
            <button
                type="button"
                className="id-btn"
                onClick={handleCopyUrl}
                aria-label="Copy share URL"
                title="Copy share URL"
            >
                <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor" aria-hidden="true">
                    <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Z"/>
                </svg>
            </button>
            <button
                ref={qrButtonRef}
                type="button"
                className="id-btn"
                onClick={handleToggleQr}
                aria-label="Show QR code"
                title="Show QR code"
            >
                <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor" aria-hidden="true">
                    <path d="M120-520v-320h320v320H120Zm80-80h160v-160H200v160Zm-80 480v-320h320v320H120Zm80-80h160v-160H200v160Zm320-320v-320h320v320H520Zm80-80h160v-160H600v160Zm160 480v-80h80v80h-80ZM520-360v-80h80v80h-80Zm80 80v-80h80v80h-80Zm-80 80v-80h80v80h-80Zm80 80v-80h80v80h-80Zm80-80v-80h80v80h-80Zm0-160v-80h80v80h-80Zm80 80v-80h80v80h-80Z"/>
                </svg>
            </button>
            <button
                type="button"
                className={`id-btn ${isPublic ? 'is-public' : ''}`}
                onClick={onToggleVisibility}
                disabled={!canToggleVisibility}
                aria-pressed={isPublic}
                aria-label={isPublic ? 'Listed publicly — make private' : 'Private — list publicly'}
                title={
                    canToggleVisibility
                        ? (isPublic ? 'Listed on the home page — click to hide' : 'Private — click to list on the home page')
                        : (isPublic ? 'Listed on the home page' : 'Private')
                }
            >
                <IconLock open={isPublic} />
            </button>

            {showQrPopup && (
                <div ref={popupRef} className="qr-popup" role="dialog" aria-label="Share QR code">
                    <div className="qr-popup-head">
                        <span className="qr-popup-label">Scan to join</span>
                        <button
                            type="button"
                            className="qr-popup-close"
                            onClick={() => setShowQrPopup(false)}
                            aria-label="Close"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor" aria-hidden="true">
                                <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                            </svg>
                        </button>
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
