import React, {useState} from 'react';
import {motion} from 'motion/react';
import {useSession} from '../context/SessionContext';
import {useConfirm} from '../context/ConfirmContext';
import {useToast} from '../context/ToastContext';
import {useTheme} from '../hooks/useTheme';
import {destroySession, toggleCurl, toggleJoin, toggleSessionEdit, transferHost} from '../utils/api';
import {IconButton} from './IconButton';
import {Copy} from './animate-ui/icons/copy';
import {X} from './animate-ui/icons/x';
import './Menu.css';

const APP_VERSION = `v${__APP_VERSION__}`;
const GITHUB_URL = 'https://github.com/SamWang8891/clippy';

const THEME_OPTIONS = [
    {id: 'system', label: 'System'},
    {id: 'light', label: 'Light'},
    {id: 'dark', label: 'Dark'},
];

// The panel drops from the corner it is pinned to and lifts back into it on
// close. A closing overlay stops taking clicks at once, so the page under it
// answers straight away rather than after the fade.
const QUICK = {duration: 0.16, ease: [0.2, 0, 0, 1]};
const FADE = {initial: {opacity: 0}, animate: {opacity: 1}, exit: {opacity: 0, pointerEvents: 'none'}};
const DROP = {initial: {opacity: 0, y: -6}, animate: {opacity: 1, y: 0}, exit: {opacity: 0, y: -6, pointerEvents: 'none'}};

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
            // Reset the path too. Reloading with it still set raced the
            // session_destroyed frame, and when the HTTP reply won, the tab
            // came back up trying to join the session it had just destroyed.
            window.history.replaceState({}, '', '/');
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

    // curl goes on only while everyone may edit — a curl upload carries
    // nobody's token — so turning it on in a room kept to its host asks to
    // open editing first. Declining leaves curl off.
    const handleToggleCurl = async () => {
        const turningOn = !session?.allow_curl_upload;
        try {
            if (turningOn && !session?.allow_edit) {
                const openEditing = await confirm({
                    title: 'Let everyone edit',
                    message: 'Curl upload only works while everyone can edit.',
                    confirmText: 'Let everyone edit',
                    cancelText: 'Cancel',
                    confirmStyle: 'primary',
                });
                if (!openEditing) return;
                await toggleSessionEdit(sessionData.connection_id, sessionData.user_id, true);
            }
            await toggleCurl(sessionData.connection_id, sessionData.user_id, turningOn);
            toast.success(turningOn ? 'Curl upload enabled' : 'Curl upload disabled');
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
            <motion.div className="menu-overlay" onClick={onClose} {...FADE} transition={QUICK}/>
            <motion.div className="menu-panel" role="dialog" aria-label="Settings" {...DROP} transition={QUICK}>
                <div className="menu-head">
                    <h2 className="menu-title">Settings</h2>
                    <IconButton
                        icon={X}
                        size={16}
                        className="menu-close"
                        onClick={onClose}
                        aria-label="Close settings"
                    />
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

                {/* A room kept to its host turns curl away, the host's own
                    included: a curl upload carries nobody's token. */}
                {session?.allow_curl_upload && session.allow_edit && (
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
                                        <IconButton
                                            icon={Copy}
                                            size={14}
                                            className="menu-curl-copy"
                                            onClick={() => handleCopyCurl(curlCommands.text)}
                                            aria-label="Copy text command"
                                            title="Copy"
                                        />
                                    </div>
                                </div>
                                <div className="menu-curl-block">
                                    <div className="menu-curl-label">Upload file</div>
                                    <div className="menu-curl-cmd">
                                        <code>{curlCommands.file}</code>
                                        <IconButton
                                            icon={Copy}
                                            size={14}
                                            className="menu-curl-copy"
                                            onClick={() => handleCopyCurl(curlCommands.file)}
                                            aria-label="Copy file command"
                                            title="Copy"
                                        />
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
                                    {user.id === sessionData.public_id && (
                                        <span className="menu-user-you">you</span>
                                    )}
                                </div>
                                {isHost && user.id !== sessionData.public_id && !user.is_host && (
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
            </motion.div>
        </>
    );
}
