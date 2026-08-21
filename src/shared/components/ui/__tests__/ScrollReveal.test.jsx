/** @jsxImportSource react */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScrollReveal from '../ScrollReveal';

describe('ScrollReveal', () => {
  beforeEach(() => {
    // Mock IntersectionObserver
    global.IntersectionObserver = class IntersectionObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('renders children content', () => {
    render(
      <ScrollReveal threshold={0.1}>
        <p>Revealed Content</p>
      </ScrollReveal>
    );
    expect(screen.getByText('Revealed Content')).toBeInTheDocument();
  });

  it('applies reveal animation when in viewport', async () => {
    const { container } = render(
      <ScrollReveal threshold={0.2} delay={100}>
        <span data-testid="reveal-target">Target</span>
      </ScrollReveal>
    );

    const target = screen.getByTestId('reveal-target');
    expect(target).toBeInTheDocument();
  });

  it('handles multiple reveal directions', () => {
    const { container } = render(
      <ScrollReveal direction="left" duration={0.5}>
        <div>Left Content</div>
      </ScrollReveal>
    );

    const card = container.firstChild;
    expect(card).toHaveClass('scroll-reveal');
    expect(card).toHaveClass('reveal-left');
  });

  it('accepts custom className', () => {
    render(
      <ScrollReveal className="custom-scroll">
        <div>Content</div>
      </ScrollReveal>
    );
    const reveal = screen.getByRole('region');
    expect(reveal).toHaveClass('custom-scroll');
  });

  it('has proper ARIA attributes', () => {
    render(<ScrollReveal aria-label="Test Reveal"><span>Test</span></ScrollReveal>);
    const region = screen.getByLabelText(/test reveal/i);
    expect(region).toHaveAttribute('role', 'region');
  });
});
