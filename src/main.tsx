import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import { A11yProvider } from './components/A11yProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import './tailwind.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <A11yProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </A11yProvider>
    </React.StrictMode>,
  );
}
