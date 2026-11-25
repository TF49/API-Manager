'use client';

import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface SpotlightCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  spotlightColor?: string;
  lift?: boolean;
  onClick?: () => void;
}

/**
 * React Bits SpotlightCard enhanced with GSAP smooth hover lift & border spotlight.
 */
export default function SpotlightCard({
  children,
  className = '',
  style,
  spotlightColor = 'rgba(99, 102, 241, 0.16)',
  lift = true,
  onClick,
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);
  const [hovered, setHovered] = useState(false);

  useGSAP({ scope: cardRef });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseEnter = () => {
    setHovered(true);
    setOpacity(1);
    if (lift && cardRef.current) {
      gsap.to(cardRef.current, {
        y: -3,
        duration: 0.25,
        ease: 'power2.out',
      });
    }
  };

  const handleMouseLeave = () => {
    setHovered(false);
    setOpacity(0);
    if (lift && cardRef.current) {
      gsap.to(cardRef.current, {
        y: 0,
        duration: 0.3,
        ease: 'power2.out',
      });
    }
  };

  // Callers often pass conditional overrides like `borderColor: active ? x : undefined`.
  // Drop undefined entries so they don't wipe out the hover styles below.
  const overrides = Object.fromEntries(
    Object.entries(style ?? {}).filter(([, value]) => value !== undefined)
  ) as React.CSSProperties;

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: hovered ? 'var(--card-hover)' : 'var(--card)',
        // Longhands (not the `border` shorthand) so callers can override borderColor safely.
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: hovered ? 'var(--border-light)' : 'var(--border)',
        borderRadius: 14,
        boxShadow: hovered
          ? '0 12px 36px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(99, 102, 241, 0.14)'
          : '0 2px 10px rgba(15, 23, 42, 0.05)',
        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.25s ease',
        ...overrides,
      }}
    >
      {/* Pointer-following radial spotlight */}
      <div
        aria-hidden="true"
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          inset: 0,
          opacity,
          transition: 'opacity 0.35s ease',
          background: `radial-gradient(360px circle at ${pos.x}px ${pos.y}px, ${spotlightColor}, transparent 65%)`,
          zIndex: 0,
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}
