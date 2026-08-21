/** @jsxImportSource react */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CountUp from '../CountUp';

describe('CountUp', () => {
  it('renders with initial count when animate is false', () => {
    render(<CountUp start={0} end={42} duration={1} animate={false} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('animates from start to end when animate is true', async () => {
    const { rerender } = render(<CountUp start={0} end={100} duration={0.5} animate={false} />);
    expect(screen.getByText('0')).toBeInTheDocument();

    // Trigger animation by setting animate to true
    rerender(<CountUp start={0} end={100} duration={0.5} animate={true} />);

    // Should see intermediate values during animation
    await new Promise(resolve => setTimeout(resolve, 600));

    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('uses default values when props not provided', () => {
    render(<CountUp />);
    // Default should show end value (0) when not animating
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('handles decimal numbers', () => {
    render(<CountUp start={0} end={99.5} duration={0.1} animate={false} />);
    expect(screen.getByText('99.5')).toBeInTheDocument();
  });

  it('handles large numbers', () => {
    render(<CountUp start={0} end={999999} duration={0.1} animate={false} />);
    expect(screen.getByText('999999')).toBeInTheDocument();
  });

  it('applies loading state visual cue', () => {
    render(<CountUp start={0} end={100} duration={1} animate={true} />);
    const container = screen.getByRole('text');
    expect(container).toHaveClass('animate-pulse');
  });
});
