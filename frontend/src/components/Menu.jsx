import React, {useState} from 'react';
import {useSession} from '../context/SessionContext';
import {useConfirm} from '../context/ConfirmContext';
import {useToast} from '../context/ToastContext';
import {useTheme} from '../hooks/useTheme';
import {destroySession, toggleCurl, toggleJoin, transferHost} from '../utils/api';
import './Menu.css';

const APP_VERSION = 'v2.0.0';
const GITHUB_URL = 'https://github.com/SamWang8891/clippy';

const THEME_OPTIONS = [
    {id: 'system', label: 'System'},
    {id: 'light', label: 'Light'},
    {id: 'dark', label: 'Dark'},
];

const CURL_TABS = [
    {id: 'unix', label: 'Linux / macOS'},
    {id: 'win', label: 'Windows'},
];

export function Menu({session, users, currentUser, onClose}) {
    const {sessionData, clearSession} = useSession();
    const confirm = useConfirm();
    const toast = useToast();
    const {theme, setTheme} = useTheme();
    const isHost = currentUser?.is_host;
    const [curlTab, setCurlTab] = useState('unix');
    const [curlExpanded, setCurlExpanded] = useState(true);

    const handleDestroyConnection = async () => {
        const confirmed = await confirm({
            title: 'Destroy connection',
            message: 'Are you sure? All users will be disconnected and all data will be lost.',
            confirmText: 'Destroy',
            cancelText: 'Cancel',
            confirmStyle: 'danger'
        });

        if (!confirmed) return;

        try {
            await destroySession(sessionData.connection_id, sessionData.user_id);
            clearSession();
            window.location.reload();
        } catch (err) {
            toast.error('Failed to destroy connection: ' + err.message);
        }
    };

    const handleTransferHost = async (newHostId) => {
        const user = users.find(u => u.id === newHostId);
        const confirmed = await confirm({
            title: 'Transfer host',
            message: `Transfer host rights to ${user?.name}? They will have full control over the connection.`,
            confirmText: 'Transfer',
            cancelText: 'Cancel',
            confirmStyle: 'primary'
        });

        if (!confirmed) return;

        try {
            await transferHost(sessionData.connection_id, sessionData.user_id, newHostId);
            toast.success('Host transferred');
        } catch (err) {
            toast.error('Failed to transfer host: ' + err.message);
        }
    };

    const handleToggleJoin = async () => {
        try {
            await toggleJoin(sessionData.connection_id, sessionData.user_id, !session.allow_join);
            toast.success(session.allow_join ? 'Joining disabled' : 'Joining enabled');
        } catch (err) {
            toast.error('Failed to toggle join: ' + err.message);
        }
    };

    const handleToggleCurl = async () => {
        try {
            await toggleCurl(sessionData.connection_id, sessionData.user_id, !session?.allow_curl_upload);
            toast.success(session?.allow_curl_upload ? 'Curl upload disabled' : 'Curl upload enabled');
        } catch (err) {
            toast.error('Failed to toggle curl upload: ' + err.message);
        }
    };

    const curlBaseUrl = `${window.location.origin}/u/${sessionData.connection_id}`;
    const curlCommands = curlTab === 'unix' ? {
        text: `curl -d 'your text' ${curlBaseUrl}`,
        file: `curl -F f=@file.txt ${curlBaseUrl}`,
    } : {
        text: `curl.exe -d "your text" ${curlBaseUrl}`,
        file: `curl.exe -F "f=@file.txt" ${curlBaseUrl}`,
    };

    const handleCopyCurl = (cmd) => {
        navigator.clipboard.writeText(cmd);
        toast.success('Copied');
    };

    return (
        <>
            <div className="menu-overlay" onClick={onClose}/>
            <div className="menu-panel" role="dialog" aria-label="Menu">
                <div className="menu-head">
                    <h2 className="menu-title">Menu</h2>
                    <button
                        type="button"
                        className="menu-close"
                        onClick={onClose}
                        aria-label="Close menu"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor" aria-hidden="true">
                            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                        </svg>
                    </button>
                </div>

                {isHost && (
                    <section className="menu-section">
                        <h3 className="menu-section-title">Session</h3>
                        <label className="menu-toggle">
                            <input
                                type="checkbox"
                                checked={session?.allow_join ?? true}
                                onChange={handleToggleJoin}
                            />
                            <span>Allow others to join</span>
                        </label>
                        <label className="menu-toggle">
                            <input
                                type="checkbox"
                                checked={session?.allow_curl_upload ?? false}
                                onChange={handleToggleCurl}
                            />
                            <span>Curl upload</span>
                        </label>
                        <button
                            type="button"
                            className="menu-danger"
                            onClick={handleDestroyConnection}
                        >
                            Destroy connection
                        </button>
                    </section>
                )}

                {session?.allow_curl_upload && (
                    <section className="menu-section">
                        <button
                            type="button"
                            className="menu-section-title menu-curl-toggle"
                            onClick={() => setCurlExpanded(!curlExpanded)}
                        >
                            <span>{curlExpanded ? '▾' : '▸'} Curl commands</span>
                        </button>
                        {curlExpanded && (
                            <div className="menu-curl">
                                <div className="menu-curl-tabs">
                                    {CURL_TABS.map((tab) => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            className={`menu-curl-tab ${curlTab === tab.id ? 'is-active' : ''}`}
                                            onClick={() => setCurlTab(tab.id)}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="menu-curl-block">
                                    <div className="menu-curl-label">Upload text</div>
                                    <div className="menu-curl-cmd">
                                        <code>{curlCommands.text}</code>
                                        <button
                                            type="button"
                                            className="menu-curl-copy"
                                            onClick={() => handleCopyCurl(curlCommands.text)}
                                            aria-label="Copy text command"
                                            title="Copy"
                                        >
                                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <rect x="5" y="5" width="8" height="9" rx="1.5" />
                                                <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v7A1.5 1.5 0 0 0 4.5 12H5" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="menu-curl-block">
                                    <div className="menu-curl-label">Upload file</div>
                                    <div className="menu-curl-cmd">
                                        <code>{curlCommands.file}</code>
                                        <button
                                            type="button"
                                            className="menu-curl-copy"
                                            onClick={() => handleCopyCurl(curlCommands.file)}
                                            aria-label="Copy file command"
                                            title="Copy"
                                        >
                                            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <rect x="5" y="5" width="8" height="9" rx="1.5" />
                                                <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v7A1.5 1.5 0 0 0 4.5 12H5" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                )}

                <section className="menu-section">
                    <h3 className="menu-section-title">Users ({users.length})</h3>
                    <ul className="menu-users">
                        {users.map((user) => (
                            <li key={user.id} className="menu-user">
                                <div className="menu-user-info">
                                    <span className="menu-user-name">{user.name}</span>
                                    {user.is_host && <span className="menu-host-tag">HOST</span>}
                                    {user.id === sessionData.user_id && (
                                        <span className="menu-user-you">you</span>
                                    )}
                                </div>
                                {isHost && user.id !== sessionData.user_id && !user.is_host && (
                                    <button
                                        type="button"
                                        className="menu-link"
                                        onClick={() => handleTransferHost(user.id)}
                                    >
                                        Transfer host
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="menu-section">
                    <h3 className="menu-section-title">Theme</h3>
                    <div className="menu-segmented" role="radiogroup" aria-label="Theme">
                        {THEME_OPTIONS.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                role="radio"
                                aria-checked={theme === opt.id}
                                className={`menu-segment ${theme === opt.id ? 'is-active' : ''}`}
                                onClick={() => setTheme(opt.id)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="menu-section">
                    <h3 className="menu-section-title">About</h3>
                    <div className="menu-about">
                        <span className="menu-version">{APP_VERSION}</span>
                        <a
                            className="menu-link"
                            href={GITHUB_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            GitHub
                        </a>
                    </div>
                </section>
            </div>
        </>
    );
}
