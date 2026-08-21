'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CountUp - Animated counter component for Vela Observatory
 *
 * Handles smooth number transitions with configurable timing.
 * No npm dependencies - hand-rolled animation using requestAnimationFrame.
 *
 * @param {number} start - Starting value (default: 0)
 * @param {number} end - Ending value (default: 0)
 * @param {number} duration - Animation duration in seconds (default: 1)
 * @param {boolean} animate - Whether to animate (default: true)
 * @param {string} className - Additional CSS classes
 * @param {number} decimals - Decimal places to display (default: 0)
 */
export default function CountUp({
  start = 0,
  end = 0,
  duration = 1,
  animate = true,
  className = '',
  decimals = 0,
}) {
  const [currentValue, setCurrentValue] = useState(end);
  const startTimeRef = useRef(null);
  const animationFrameRef = useRef(null);
  const isAnimatingRef = useRef(false);

  // Format number with specified decimal places
  const formatNumber = (num) => {
    return num.toFixed(decimals);
  };

  // Animation loop using requestAnimationFrame
  const animateValue = (timestamp) => {
    if (!startTimeRef.current) {
      startTimeRef.current = timestamp;
    }

    const elapsed = (timestamp - startTimeRef.current) / 1000; // Convert to seconds
    const progress = Math.min(elapsed / duration, 1);

    // Easing function: easeOutQuart for smooth ending
    const easedProgress = 1 - Math.pow(1 - progress, 4);
    const interpolatedValue = start + (end - start) * easedProgress;

    setCurrentValue(formatNumber(interpolatedValue));

    if (progress < 1) {
      animationFrameRef.current = requestAnimationFrame(animateValue);
    } else {
      isAnimatingRef.current = false;
      setCurrentValue(formatNumber(end)); // Ensure exact end value
    }
  };

  // Start animation when animate prop changes to true
  useEffect(() => {
    if (animate && !isAnimatingRef.current) {
      isAnimatingRef.current = true;
      startTimeRef.current = null;

      // If we're animating from a different start value, reset immediately
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(animateValue);
    }

    // Cleanup on unmount or when animate becomes false
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animate, start, end, duration]);

  // Stop animation and show final value when animate is false
  useEffect(() => {
    if (!animate && isAnimatingRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      isAnimatingRef.current = false;
      setCurrentValue(formatNumber(end));
    }
  }, [animate, end]);

  return (
    <span className={`count-up ${className}`}>
      {currentValue}
      {animate && isAnimatingRef.current && (
        <span className="inline-block w-1 h-4 ml-1 align-middle bg-observatory-orange-base animate-pulse" />
      )}
    </span>
  );
}
