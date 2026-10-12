import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import {initConfig} from './utils/config';
import './index.css';

// Started before the first render, but nothing waits for it: each call that
// needs the backend awaits it on its own (see configReady).
initConfig();

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
);
