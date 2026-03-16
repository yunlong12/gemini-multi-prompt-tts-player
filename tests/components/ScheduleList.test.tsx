import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ScheduleList } from '../../components/ScheduleList';
import { makeSchedule } from '../helpers/fixtures';

describe('ScheduleList', () => {
  it('renders timezone from schedule.timezone and wires action callbacks', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onRunNow = vi.fn();
    const onToggleEnabled = vi.fn();

    render(
      <ScheduleList
        schedules={[
          makeSchedule({
            timezone: 'Asia/Tokyo',
            promptTemplate: 'P'.repeat(280),
            lastStatus: 'error',
            lastError: 'E'.repeat(300),
          }),
        ]}
        onEdit={onEdit}
        onDelete={onDelete}
        onRunNow={onRunNow}
        onToggleEnabled={onToggleEnabled}
        editingScheduleId={null}
        pendingScheduleActionId={null}
        pendingScheduleActionType={null}
      />
    );

    expect(screen.getByText('Asia/Tokyo')).toBeInTheDocument();

    const expandPromptButton = screen.getByRole('button', { name: /expand prompt/i });
    const showDetailsButton = screen.getByRole('button', { name: /show details/i });
    const runNowButton = screen.getByRole('button', { name: /run now/i });
    const editButton = screen.getByRole('button', { name: /^edit$/i });
    const deleteButton = screen.getByRole('button', { name: /^delete$/i });
    const enabledButton = screen.getByRole('button', { name: /schedule enabled/i });

    expect(expandPromptButton).toHaveAttribute('type', 'button');
    expect(showDetailsButton).toHaveAttribute('type', 'button');
    expect(runNowButton).toHaveAttribute('type', 'button');
    expect(editButton).toHaveAttribute('type', 'button');
    expect(deleteButton).toHaveAttribute('type', 'button');
    expect(enabledButton).toHaveAttribute('type', 'button');

    await user.click(expandPromptButton);
    await user.click(showDetailsButton);
    await user.click(runNowButton);
    await user.click(editButton);
    await user.click(deleteButton);
    await user.click(enabledButton);

    expect(onRunNow).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onToggleEnabled).toHaveBeenCalledTimes(1);
  });
});
