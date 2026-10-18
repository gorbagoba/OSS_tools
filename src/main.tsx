import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import { A11yProvider } from './components/A11yProvider';
import './tailwind.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <A11yProvider>
        <App />
      </A11yProvider>
    </React.StrictMode>,
  );
}
