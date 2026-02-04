import React from 'react';
import {useSession} from '../context/SessionContext';
import {destroySession, toggleJoin, transferHost} from '../utils/api';
import './Menu.css';

export function Menu({session, users, currentUser, onClose}) {
    const {sessionData, clearSession} = useSession();
    const isHost = currentUser?.is_host;

    const handleDestroyConnection = async () => {
        if (!confirm('Are you sure you want to destroy this connection?')) return;

        try {
            await destroySession(sessionData.connection_id, sessionData.user_id);
            clearSession();
            window.location.reload();
        } catch (err) {
            alert('Failed to destroy connection: ' + err.message);
        }
    };

    const handleTransferHost = async (newHostId) => {
        if (!confirm('Transfer host rights to this user?')) return;

        try {
            await transferHost(sessionData.connection_id, sessionData.user_id, newHostId);
        } catch (err) {
            alert('Failed to transfer host: ' + err.message);
        }
    };

    const handleToggleJoin = async () => {
        try {
            await toggleJoin(sessionData.connection_id, sessionData.user_id, !session.allow_join);
        } catch (err) {
            alert('Failed to toggle join permission: ' + err.message);
        }
    };

    return (
        <>
            <div className="menu-overlay" onClick={onClose}/>
            <div className="menu-panel">
                <div className="menu-header">
                    <h2>Connection Menu</h2>
                    <button className="close-button" onClick={onClose}>
                        ✕
                    </button>
                </div>

                <div className="menu-section">
                    <h3>Connectors ({users.length})</h3>
                    <div className="user-list">
                        {users.map((user) => (
                            <div key={user.id} className="user-item">
                                <div className="user-info">
                  <span className="user-name">
                    {user.name}
                      {user.is_host && ' 👑'}
                      {user.id === sessionData.user_id && ' (You)'}
                  </span>
                                </div>
                                {isHost && user.id !== sessionData.user_id && (
                                    <button
                                        className="transfer-button"
                                        onClick={() => handleTransferHost(user.id)}
                                    >
                                        Make Host
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {isHost && (
                    <>
                        <div className="menu-section">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={session?.allow_join ?? true}
                                    onChange={handleToggleJoin}
                                />
                                <span>Allow others to join</span>
                            </label>
                        </div>

                        <div className="menu-section">
                            <button className="danger-button" onClick={handleDestroyConnection}>
                                Destroy Connection
                            </button>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
