import React from 'react';
import {useSession} from '../context/SessionContext';
import {useConfirm} from '../context/ConfirmContext';
import {useToast} from '../context/ToastContext';
import {destroySession, toggleJoin, transferHost} from '../utils/api';
import './Menu.css';

export function Menu({session, users, currentUser, onClose}) {
    const {sessionData, clearSession} = useSession();
    const confirm = useConfirm();
    const toast = useToast();
    const isHost = currentUser?.is_host;

    const handleDestroyConnection = async () => {
        const confirmed = await confirm({
            title: 'Destroy Connection',
            message: 'Are you sure you want to destroy this connection? All users will be disconnected and all data will be lost.',
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
            title: 'Transfer Host Rights',
            message: `Transfer host rights to ${user?.name}? They will have full control over the connection.`,
            confirmText: 'Transfer',
            cancelText: 'Cancel',
            confirmStyle: 'primary'
        });

        if (!confirmed) return;

        try {
            await transferHost(sessionData.connection_id, sessionData.user_id, newHostId);
            toast.success('Host rights transferred successfully');
        } catch (err) {
            toast.error('Failed to transfer host: ' + err.message);
        }
    };

    const handleToggleJoin = async () => {
        try {
            await toggleJoin(sessionData.connection_id, sessionData.user_id, !session.allow_join);
            toast.success(session.allow_join ? 'New users can no longer join' : 'New users can now join');
        } catch (err) {
            toast.error('Failed to toggle join permission: ' + err.message);
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
                      {user.is_host && (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16"
                               style={{marginLeft: '6px', verticalAlign: 'middle'}}>
                              <path d="M256 80 L340 200 L426 100 L400 320 L112 320 L86 100 L172 200 Z" fill="#F9B233"/>
                              <rect x="96" y="340" width="320" height="60" rx="10" ry="10" fill="#F9B233"/>
                          </svg>
                      )}
                      {user.name}
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
