'use client';

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface MagnetProps {
  children: React.ReactNode;
  padding?: number;
  magnetStrength?: number;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * React Bits Magnet powered by GSAP quickTo for silky 60fps cursor attraction.
 */
export default function Magnet({
  children,
  magnetStrength = 0.25,
  disabled = false,
  className = '',
  style,
}: MagnetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const xTo = useRef<gsap.QuickToFunc | null>(null);
  const yTo = useRef<gsap.QuickToFunc | null>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      xTo.current = gsap.quickTo(ref.current, 'x', { duration: 0.35, ease: 'power3.out' });
      yTo.current = gsap.quickTo(ref.current, 'y', { duration: 0.35, ease: 'power3.out' });
    },
    { scope: ref }
  );

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !ref.current || !xTo.current || !yTo.current) return;
    const rect = ref.current.getBoundingClientRect();
    const offsetX = (e.clientX - (rect.left + rect.width / 2)) * magnetStrength;
    const offsetY = (e.clientY - (rect.top + rect.height / 2)) * magnetStrength;
    xTo.current(offsetX);
    yTo.current(offsetY);
  };

  const handleMouseLeave = () => {
    if (!xTo.current || !yTo.current) return;
    xTo.current(0);
    yTo.current(0);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{ display: 'inline-block', ...style }}
    >
      {children}
    </div>
  );
}
