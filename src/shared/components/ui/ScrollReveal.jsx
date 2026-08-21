'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * ScrollReveal - Intersection Observer-based reveal animation
 *
 * Reveals content when it enters the viewport with smooth transitions.
 * No npm dependencies - uses native IntersectionObserver API.
 *
 * @param {React.ReactNode} children - Content to reveal
 * @param {string} className - Additional CSS classes
 * @param {'up' | 'down' | 'left' | 'right'} direction - Reveal direction (default: 'up')
 * @param {number} threshold - Intersection ratio threshold (default: 0.1)
 * @param {number} duration - Animation duration in seconds (default: 0.6)
 * @param {number} delay - Delay before animation starts (default: 0)
 */
export default function ScrollReveal({
  children,
  className = '',
  direction = 'up',
  threshold = 0.1,
  duration = 0.6,
  delay = 0,
  ariaLabel = 'Animated content',
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [hasIntersected, setHasIntersected] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    // Handle case where element is already in view on mount
    if (ref.current && document.visibilityState === 'visible') {
      const observerCallback = (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setHasIntersected(true);
            setTimeout(() => {
              setIsVisible(true);
            }, delay);
          }
        });
      };

      const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold,
      };

      const observer = new IntersectionObserver(observerCallback, observerOptions);
      observer.observe(ref.current);

      return () => {
        observer.disconnect();
      };
    }
  }, [direction, threshold, delay]);

  const getTransformValue = () => {
    switch (direction) {
      case 'up':
        return hasIntersected ? 'translateY(0)' : 'translateY(30px)';
      case 'down':
        return hasIntersected ? 'translateY(0)' : 'translateY(-30px)';
      case 'left':
        return hasIntersected ? 'translateX(0)' : 'translateX(30px)';
      case 'right':
        return hasIntersected ? 'translateX(0)' : 'translateX(-30px)';
      default:
        return hasIntersected ? 'translateY(0)' : 'translateY(30px)';
    }
  };

  const getOpacityValue = () => {
    return hasIntersected ? 1 : 0;
  };

  return (
    <section
      ref={ref}
      role="region"
      aria-label={ariaLabel}
      className={`scroll-reveal relative ${className}`}
      style={{
        transition: `transform ${duration}s ease-out ${delay}s, opacity ${duration}s ease-out ${delay}s`,
        transform: getTransformValue(),
        opacity: getOpacityValue(),
      }}
    >
      {children}
    </section>
  );
}
