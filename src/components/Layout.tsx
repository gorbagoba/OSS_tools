import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useA11y } from '../hooks/useA11y';

export interface LayoutProps {
  children: React.ReactNode;
}

// Layout component with navigation
export function Layout({ children }: LayoutProps): React.JSX.Element {
  const location = useLocation();
  const { announce } = useA11y();
  const skipToContentId = 'main-content';
  const [isSkipLinkFocused, setIsSkipLinkFocused] = useState(false);

  // Use isSkipLinkFocused to avoid unused variable warning
  void isSkipLinkFocused;

  // Announce route changes for screen readers
  useEffect(() => {
    const pathMap: Record<string, string> = {
      '/': 'Background Remover',
      '/photo-editor': 'Photo Editor',
      '/qr-generator': 'QR Code Generator',
    };

    const pageName = pathMap[location.pathname] || 'Page';
    announce(`Navigated to ${pageName}`);
  }, [location.pathname, announce]);

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-bg text-text font-sans flex flex-col">
      {/* Skip navigation link (WCAG 2.2 AA) */}
      <a
        href={`#${skipToContentId}`}
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
        onFocus={() => setIsSkipLinkFocused(true)}
        onBlur={() => setIsSkipLinkFocused(false)}
      >
        Skip to main content
      </a>

      <nav
        className="navbar bg-input border-b border-border px-6 py-4 flex items-center justify-between"
        role="navigation"
        aria-label="Main navigation"
      >
        <Link to="/" className="text-lg font-semibold" aria-label="Photo Tools Home">
          Photo Tools
        </Link>
        <div className="flex gap-5" role="menubar" aria-label="Primary">
          <Link
            to="/"
            role="menuitem"
            className={`px-3 py-2 rounded transition-colors ${
              isActive('/')
                ? 'text-primary bg-primary/10'
                : 'text-textSecondary hover:text-text hover:bg-border'
            }`}
          >
            Background Remover
          </Link>
          <Link
            to="/photo-editor"
            role="menuitem"
            className={`px-3 py-2 rounded transition-colors ${
              isActive('/photo-editor')
                ? 'text-primary bg-primary/10'
                : 'text-textSecondary hover:text-text hover:bg-border'
            }`}
          >
            Photo Editor
          </Link>
          <Link
            to="/qr-generator"
            role="menuitem"
            className={`px-3 py-2 rounded transition-colors ${
              isActive('/qr-generator')
                ? 'text-primary bg-primary/10'
                : 'text-textSecondary hover:text-text hover:bg-border'
            }`}
          >
            QR Generator
          </Link>
        </div>
      </nav>

      <main id={skipToContentId} className="flex-1 px-4 py-8 max-w-6xl mx-auto w-full" role="main">
        {children}
      </main>
    </div>
  );
}
