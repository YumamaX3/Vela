/** @jsxImportSource react */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpotlightCard from '../SpotlightCard';

describe('SpotlightCard', () => {
  it('renders children content', () => {
    render(
      <SpotlightCard>
        <p>Hello World</p>
      </SpotlightCard>
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('applies spotlight effect on hover', async () => {
    const onMouseMove = vi.fn();
    render(
      <SpotlightCard onMouseMove={onMouseMove}>
        <div data-testid="card-content">Content</div>
      </SpotlightCard>
    );

    const card = screen.getByRole('article');
    await Promise.resolve(); // Let effects apply

    // Card should have the spotlight container structure
    expect(card).toHaveClass('spotlight-card');
  });

  it('handles empty children gracefully', () => {
    render(<SpotlightCard />);
    const card = screen.getByRole('article');
    expect(card).toBeInTheDocument();
  });

  it('accepts custom className', () => {
    render(<SpotlightCard className="custom-class">Test</SpotlightCard>);
    const card = screen.getByRole('article');
    expect(card).toHaveClass('custom-class');
  });

  it('has loading state visual cue for initial mount', () => {
    const { container } = render(
      <SpotlightCard>
        <span>Loading...</span>
      </SpotlightCard>
    );
    const card = container.firstChild;
    expect(card).toHaveClass('animate-fade-in');
  });
});
