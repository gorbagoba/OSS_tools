import { useState, useEffect, useCallback } from 'react';

export function useA11y() {
  const skipToContentId = 'main-content';
  const [isSkipLinkFocused, setIsSkipLinkFocused] = useState(false);
  const [announcerId] = useState<string>(`announcer-${Math.random().toString(36).substring(2, 9)}`);

  // Create live region for screen reader announcements
  useEffect(() => {
    const existing = document.getElementById(announcerId);
    if (!existing) {
      const announcer = document.createElement('div');
      announcer.id = announcerId;
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      announcer.className = 'sr-only';
      document.body.appendChild(announcer);

      return () => {
        if (document.body.contains(announcer)) {
          document.body.removeChild(announcer);
        }
      };
    }
    return undefined;
  }, [announcerId]);

  const announce = useCallback(
    (message: string) => {
      const announcer = document.getElementById(announcerId);
      if (announcer) {
        // Clear and set to ensure screen readers pick up changes
        announcer.textContent = '';
        setTimeout(() => {
          announcer.textContent = message;
        }, 50);
      }
    },
    [announcerId],
  );

  useEffect(() => {
    const handleSkipLinkFocus = () => setIsSkipLinkFocused(true);
    const handleBlur = () => setIsSkipLinkFocused(false);

    const skipLink = document.querySelector('a[href="#main-content"]');
    if (skipLink) {
      skipLink.addEventListener('focus', handleSkipLinkFocus);
      skipLink.addEventListener('blur', handleBlur);
    }

    return () => {
      if (skipLink) {
        skipLink.removeEventListener('focus', handleSkipLinkFocus);
        skipLink.removeEventListener('blur', handleBlur);
      }
    };
  }, []);

  return { skipToContentId, isSkipLinkFocused, announce } as const;
}
