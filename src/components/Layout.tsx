import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useA11y } from '../hooks/useA11y';
import { ToastProvider } from './ToastProvider';

export interface LayoutProps {
  children: React.ReactNode;
}

interface ToolEntry {
  to: string;
  label: string;
  group: 'Image' | 'Document' | 'Utility';
}

const TOOLS: ToolEntry[] = [
  { to: '/', label: 'Background Remover', group: 'Image' },
  { to: '/photo-editor', label: 'Photo Editor', group: 'Image' },
  { to: '/image-compressor', label: 'Image Compressor', group: 'Image' },
  { to: '/heic-converter', label: 'HEIC → JPG', group: 'Image' },
  { to: '/convert-to-markdown', label: 'MD Converter', group: 'Document' },
  { to: '/pdf-toolkit', label: 'PDF Toolkit', group: 'Document' },
  { to: '/qr-generator', label: 'QR Generator', group: 'Utility' },
];

const GROUP_ORDER: ToolEntry['group'][] = ['Image', 'Document', 'Utility'];

// Layout component with navigation
export function Layout({ children }: LayoutProps): React.JSX.Element {
  const location = useLocation();
  const { announce } = useA11y();
  const skipToContentId = 'main-content';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Announce route changes for screen readers (label derived from TOOLS)
  useEffect(() => {
    const pageName = TOOLS.find((t) => t.to === location.pathname)?.label ?? 'Page';
    announce(`Navigated to ${pageName}`);
  }, [location.pathname, announce]);

  // Close the dropdown on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  // Close the dropdown after navigating (route change while open)
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const activeLabel = TOOLS.find((t) => t.to === location.pathname)?.label ?? 'Background Remover';

  const toggleMenu = useCallback((): void => {
    setMenuOpen((prev) => !prev);
  }, []);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-bg text-text font-sans flex flex-col">
        {/* Skip navigation link (WCAG 2.2 AA) */}
        <a
          href={`#${skipToContentId}`}
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
        >
          Skip to main content
        </a>

        <nav
          className="navbar bg-input border-b border-border px-6 py-4 flex items-center justify-between"
          role="navigation"
          aria-label="Main navigation"
        >
          <Link to="/" className="text-lg font-semibold" aria-label="OSS Tools Home">
            OSS Tools
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Tools menu, current tool: ${activeLabel}`}
              onClick={toggleMenu}
              className="px-4 py-2 rounded border border-border bg-bg hover:bg-border transition-colors flex items-center gap-2"
            >
              <span>Tools</span>
              <span aria-hidden="true">{menuOpen ? '▲' : '▼'}</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label="Available tools"
                className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-input shadow-lg py-2 z-50"
              >
                {GROUP_ORDER.map((group) => (
                  <div key={group}>
                    <div
                      aria-hidden="true"
                      className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-textSecondary"
                    >
                      {group}
                    </div>
                    {TOOLS.filter((t) => t.group === group).map((tool) => {
                      const isActive = location.pathname === tool.to;
                      return (
                        <Link
                          key={tool.to}
                          to={tool.to}
                          role="menuitem"
                          aria-current={isActive ? 'page' : undefined}
                          className={`block px-3 py-2 transition-colors ${
                            isActive
                              ? 'text-primary bg-primary/10'
                              : 'text-textSecondary hover:text-text hover:bg-border'
                          }`}
                        >
                          {tool.label}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </nav>

        <main id={skipToContentId} className="flex-1 px-4 py-8 max-w-6xl mx-auto w-full" role="main">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
