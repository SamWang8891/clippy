import React, {useEffect, useMemo, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {useToast} from '../context/ToastContext';
import './ClipboardInterface.css';

/**
 * Connection-id pill with copy-URL and QR-code popover.
 *
 * The QR is generated client-side so the URL fragment (which contains the
 * end-to-end encryption key) never leaves the browser.
 */
export function Id({sessionData}) {
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
        QRCode.toDataURL(currentUrl, {width: 240, margin: 1})
            .then((url) => {
                if (!cancelled) setQrDataUrl(url);
            })
            .catch((err) => {
                console.error('QR code generation failed:', err);
                if (!cancelled) setQrError(true);
            });
        return () => {
            cancelled = true;
        };
    }, [showQrPopup, currentUrl]);

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(currentUrl);
            toast.success('URL copied to clipboard!');
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

    const containerStyle = useMemo(() => ({
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
    }), []);

    return (
        <div style={containerStyle}>
            Connection ID: <strong>{sessionData?.connection_id}</strong>
            <button
                onClick={handleCopyUrl}
                title="Copy URL to clipboard"
                style={{background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center'}}
            >
                <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                    <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"/>
                </svg>
            </button>
            <button
                ref={qrButtonRef}
                onClick={handleToggleQr}
                title="Show QR code"
                style={{background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center'}}
            >
                <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
                    <path d="M120-520v-320h320v320H120Zm80-80h160v-160H200v160Zm-80 480v-320h320v320H120Zm80-80h160v-160H200v160Zm320-320v-320h320v320H520Zm80-80h160v-160H600v160Zm160 480v-80h80v80h-80ZM520-360v-80h80v80h-80Zm80 80v-80h80v80h-80Zm-80 80v-80h80v80h-80Zm80 80v-80h80v80h-80Zm80-80v-80h80v80h-80Zm0-160v-80h80v80h-80Zm80 80v-80h80v80h-80Z"/>
                </svg>
            </button>

            {showQrPopup && (
                <div ref={popupRef} className="qr-popup" style={{position: 'absolute', top: '100%', right: '0', marginTop: '8px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', padding: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000}}>
                    <div style={{position: 'absolute', top: '-8px', right: '20px', width: '0', height: '0', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid #ddd'}}/>
                    <div style={{position: 'absolute', top: '-7px', right: '21px', width: '0', height: '0', borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: '7px solid white'}}/>
                    <div style={{textAlign: 'center'}}>
                        <p style={{margin: '0 0 12px 0', fontSize: '14px', fontWeight: '500'}}>Scan to join connection</p>
                        {qrDataUrl ? (
                            <img src={qrDataUrl} alt="QR Code" style={{width: '240px', height: '240px', margin: '0 auto', display: 'block'}}/>
                        ) : qrError ? (
                            <div style={{width: '240px', height: '240px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c33'}}>
                                Failed to render QR
                            </div>
                        ) : (
                            <div style={{width: '240px', height: '240px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888'}}>
                                <div style={{width: '28px', height: '28px', border: '3px solid #ddd', borderTopColor: '#888', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '10px'}}/>
                                <span style={{fontSize: '13px'}}>Generating QR Code</span>
                            </div>
                        )}
                        <p style={{margin: '12px 0 0 0', fontSize: '12px', color: '#666', wordBreak: 'break-all'}}>{currentUrl}</p>
                        <button
                            onClick={() => setShowQrPopup(false)}
                            style={{marginTop: '12px', padding: '6px 16px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer'}}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
