'use client';

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface BlurTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  stagger?: number;
  animateBy?: 'chars' | 'words';
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
}

/**
 * React Bits BlurText powered by GSAP stagger reveal.
 */
export default function BlurText({
  text,
  className = '',
  style,
  delay = 0,
  stagger = 0.035,
  animateBy = 'chars',
  as: Tag = 'h1',
}: BlurTextProps) {
  const containerRef = useRef<HTMLElement>(null);
  const tokens = animateBy === 'words' ? text.split(' ') : Array.from(text);

  useGSAP(
    () => {
      const el = containerRef.current;
      if (!el) return;
      const items = el.querySelectorAll('.rb-blur-token');
      if (!items.length) return;

      gsap.fromTo(
        items,
        {
          opacity: 0,
          y: 10,
          filter: 'blur(8px)',
        },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.45,
          stagger,
          delay,
          ease: 'power3.out',
          clearProps: 'filter,transform',
        }
      );
    },
    { scope: containerRef, dependencies: [text] }
  );

  return (
    <Tag
      ref={containerRef as React.RefObject<never>}
      className={className}
      style={{ display: 'inline-flex', flexWrap: 'wrap', ...style }}
    >
      {tokens.map((token, i) => (
        <span
          key={`${token}-${i}`}
          className="rb-blur-token"
          style={{
            display: 'inline-block',
            whiteSpace: token === ' ' ? 'pre' : undefined,
            marginRight: animateBy === 'words' && i < tokens.length - 1 ? '0.28em' : undefined,
          }}
        >
          {token}
        </span>
      ))}
    </Tag>
  );
}
