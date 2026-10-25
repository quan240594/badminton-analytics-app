import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressBar from './ProgressBar.jsx';

describe('ProgressBar', () => {
  it('sizes the fill to the percentage and shows it rounded', () => {
    const { container } = render(<ProgressBar percent={42.6} />);

    expect(screen.getByText('43%')).toBeInTheDocument();
    expect(container.querySelector('.progress-bar-fill')).toHaveStyle({ width: '42.6%' });
  });
});
