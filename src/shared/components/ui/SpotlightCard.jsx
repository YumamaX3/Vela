'use client';

import { useState, useRef, useCallback } from 'react';

/**
 * SpotlightCard - Interactive card with spotlight hover effect
 *
 * Creates a glow that follows the cursor position within the card.
 * No npm dependencies - hand-rolled using mouse event tracking.
 *
 * @param {React.ReactNode} children - Card content
 * @param {string} className - Additional CSS classes
 * @param {number} glowSize - Size of the spotlight glow in pixels (default: 100)
 * @param {boolean} bordered - Whether to show border highlight (default: true)
 */
export default function SpotlightCard({
  children,
  className = '',
  glowSize = 100,
  bordered = true,
}) {
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const cardRef = useRef(null);

  const handleMouseMove = useCallback((e) => {
    if (!cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCoords({ x, y });
  }, []);

  return (
    <article
      ref={cardRef}
      className={`spotlight-card relative overflow-hidden rounded-lg ${bordered ? 'border border-observatory-paper-300' : ''} ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false);
        setCoords({ x: 0, y: 0 });
      }}
      role="article"
      aria-labelledby="spotlight-card-content"
    >
      {/* Background layer */}
      <div className="absolute inset-0 bg-observatory-surface-base z-0" />

      {/* Spotlight glow effect */}
      {isHovering && (
        <div
          className="pointer-events-none absolute z-10 rounded-full opacity-50 blur-xl"
          style={{
            width: `${glowSize * 2}px`,
            height: `${glowSize * 2}px`,
            left: `calc(${coords.x}px - ${glowSize}px)`,
            top: `calc(${coords.y}px - ${glowSize}px)`,
            background: `radial-gradient(circle, rgba(229, 106, 74, 0.15), transparent 70%)`,
          }}
        />
      )}

      {/* Border highlight on hover */}
      {isHovering && bordered && (
        <div
          className="absolute pointer-events-none z-20"
          style={{
            width: '100%',
            height: '100%',
            top: 0,
            left: 0,
            padding: '1px',
            backgroundImage: `radial-gradient(circle at ${coords.x}px ${coords.y}px, rgba(229, 106, 74, 0.4), transparent 150px)`,
            borderRadius: 'inherit',
          }}
        />
      )}

      {/* Content layer */}
      <div className="relative z-30 p-6 animate-fade-in">
        {children}
      </div>
    </article>
  );
}
