'use client';

import React, { useRef } from 'react';
import { useTenant } from '../../context/tenant-context';

export function SwipeContainer({ children }: { children: React.ReactNode }) {
  const { isMobileNavOpen, setIsMobileNavOpen } = useTenant();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX.current;
    const deltaY = touchEndY - touchStartY.current;

    // Only trigger if horizontal swipe is clearly dominant over vertical scrolling
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      // Swipe right from left edge (< 40px from screen left) opens drawer
      if (!isMobileNavOpen && touchStartX.current < 45 && deltaX > 50) {
        setIsMobileNavOpen(true);
      }
      // Swipe left anywhere closes drawer if open
      else if (isMobileNavOpen && deltaX < -50) {
        setIsMobileNavOpen(false);
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="flex-1 flex overflow-hidden relative"
    >
      {children}
    </div>
  );
}
