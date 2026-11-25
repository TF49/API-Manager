'use client';

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

/**
 * Subtle ambient GSAP-animated aurora orbs behind the main app canvas.
 */
export default function AuroraBackdrop() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const orb1 = wrapRef.current?.querySelector('.aurora-orb-1');
      const orb2 = wrapRef.current?.querySelector('.aurora-orb-2');
      if (orb1) {
        gsap.to(orb1, {
          x: 60,
          y: 25,
          scale: 1.12,
          duration: 9,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        });
      }
      if (orb2) {
        gsap.to(orb2, {
          x: -50,
          y: 35,
          scale: 0.9,
          duration: 11,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        });
      }
    },
    { scope: wrapRef }
  );

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <div
        className="aurora-orb-1"
        style={{
          position: 'absolute',
          top: -180,
          left: '12%',
          width: 560,
          height: 360,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.14) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="aurora-orb-2"
        style={{
          position: 'absolute',
          top: -140,
          right: '10%',
          width: 480,
          height: 320,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.09) 0%, transparent 70%)',
          filter: 'blur(45px)',
        }}
      />
    </div>
  );
}
