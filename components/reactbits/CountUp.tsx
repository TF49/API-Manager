'use client';

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface CountUpProps {
  to: number;
  from?: number;
  duration?: number;
  delay?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * React Bits CountUp powered by GSAP tweening.
 */
export default function CountUp({
  to,
  from = 0,
  duration = 0.75,
  delay = 0,
  suffix = '',
  prefix = '',
  className = '',
  style,
}: CountUpProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef<number>(from);

  useGSAP(
    () => {
      const el = spanRef.current;
      if (!el) return;

      const counter = { value: prevRef.current };
      gsap.to(counter, {
        value: to,
        duration,
        delay,
        ease: 'power3.out',
        onUpdate: () => {
          if (spanRef.current) {
            spanRef.current.textContent = `${prefix}${Math.round(counter.value)}${suffix}`;
          }
        },
        onComplete: () => {
          prevRef.current = to;
        },
      });
    },
    { scope: spanRef, dependencies: [to] }
  );

  return (
    <span ref={spanRef} className={className} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefix}
      {from}
      {suffix}
    </span>
  );
}
