// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomCodeJoinForm } from '../src/components/RoomCodeJoinForm';

describe('RoomCodeJoinForm', () => {
  afterEach(() => cleanup());

  it('normalizes lower-case room codes before navigating', () => {
    const navigate = vi.fn();
    render(createElement(RoomCodeJoinForm, { onNavigate: navigate }));

    fireEvent.change(screen.getByLabelText('입장 코드'), { target: { value: 'ab12' } });
    fireEvent.click(screen.getByRole('button', { name: '코드로 입장' }));

    expect(navigate).toHaveBeenCalledWith('/c/AB12');
  });

  it('rejects incomplete codes without navigation', () => {
    const navigate = vi.fn();
    render(createElement(RoomCodeJoinForm, { onNavigate: navigate }));

    fireEvent.change(screen.getByLabelText('입장 코드'), { target: { value: 'a1' } });
    fireEvent.click(screen.getByRole('button', { name: '코드로 입장' }));

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('4자리 영문·숫자 코드를 입력해 주세요.');
  });
});
