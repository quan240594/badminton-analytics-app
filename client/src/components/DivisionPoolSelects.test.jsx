import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DivisionPoolSelects from './DivisionPoolSelects.jsx';

const POOLS = [
  { drawId: '30', label: 'Mannen Veer 2 afd. 12' },
  { drawId: '20', label: 'Mannen Veer 2 afd. 3' },
];

function renderSelects(props = {}) {
  const handlers = { onDivisionChange: vi.fn(), onPoolChange: vi.fn() };
  render(
    <DivisionPoolSelects
      divisions={['Mannen Veer 2', '2e divisie', 'Eredivisie', '1e divisie']}
      division="Mannen Veer 2"
      poolAfdelingen={POOLS}
      drawId="30"
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

const optionTexts = (name) => within(screen.getByRole('combobox', { name })).getAllByRole('option').map((o) => o.textContent);

describe('DivisionPoolSelects', () => {
  it('orders divisions by competitive rank and pools by afdeling number', () => {
    renderSelects();

    expect(optionTexts(/Division/)).toEqual(['Eredivisie', '1e divisie', '2e divisie', 'Mannen Veer 2']);
    expect(optionTexts(/Pool/)).toEqual(['Afd. 3', 'Afd. 12']);
  });

  it('reports division and pool changes', () => {
    const { onDivisionChange, onPoolChange } = renderSelects();

    fireEvent.change(screen.getByRole('combobox', { name: /Division/ }), { target: { value: '2e divisie' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Pool/ }), { target: { value: '20' } });

    expect(onDivisionChange).toHaveBeenCalledWith('2e divisie');
    expect(onPoolChange).toHaveBeenCalledWith('20');
  });

  it('disables the pool select when the division has no pools', () => {
    renderSelects({ poolAfdelingen: [], drawId: '' });

    expect(screen.getByRole('combobox', { name: /Pool/ })).toBeDisabled();
  });
});
