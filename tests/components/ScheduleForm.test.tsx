import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ScheduleForm } from '../../components/ScheduleForm';
import { makeSchedule } from '../helpers/fixtures';

describe('ScheduleForm', () => {
  it('toggles tool options, weekday buttons, submits draft, and can cancel', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(<ScheduleForm onSubmit={onSubmit} onCancel={onCancel} isSaving={false} />);

    await user.click(screen.getByRole('button', { name: /google search on/i }));
    await user.click(screen.getByRole('button', { name: /url context off/i }));
    await user.selectOptions(screen.getByLabelText(/frequency/i), 'weekly');
    await user.click(await screen.findByRole('button', { name: 'Sun' }));
    await user.type(screen.getByLabelText(/name/i), ' News Roundup');
    await user.type(screen.getByLabelText(/prompt template/i), ' Explain today.');
    await user.click(screen.getByRole('button', { name: /create schedule/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: ' News Roundup',
      enableGoogleSearch: false,
      enableUrlContext: true,
      frequency: 'weekly',
    });
    expect(onSubmit.mock.calls[0][0].daysOfWeek).toContain(0);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('preloads an editing schedule, updates cadence fields, and shows next run preview context', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const schedule = makeSchedule({
      name: 'Evening Briefing',
      frequency: 'daily',
      timeOfDay: '18:30',
      nextRunAt: '2026-03-16T18:30:00.000Z',
    });

    render(<ScheduleForm initialValue={schedule} onSubmit={onSubmit} onCancel={onCancel} isSaving={false} />);

    const form = screen.getByRole('form', { name: /edit schedule evening briefing/i });
    expect(form).toBeInTheDocument();
    expect(within(form).getByDisplayValue('Evening Briefing')).toBeInTheDocument();
    expect(within(form).getByText(/next run preview/i)).toBeInTheDocument();

    await user.selectOptions(within(form).getByLabelText(/frequency/i), 'custom_interval');
    const intervalInput = within(form).getByLabelText(/interval minutes/i);
    fireEvent.change(intervalInput, { target: { value: '45' } });
    await user.click(within(form).getByRole('button', { name: /update schedule/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      id: 'schedule-1',
      frequency: 'custom_interval',
      intervalMinutes: 45,
    }));
  });
});
