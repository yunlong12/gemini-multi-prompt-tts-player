# Button Regression Inventory

This inventory captures the current user-visible button and action surface so regression tests can protect behavior when future features are added.

## Auth

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Sign In | `Sign In` submit button in login form | Password entered, app unauthenticated | Stores admin session, leaves login gate, starts admin/manual refresh flows | `POST /api/auth/login`, then `GET /api/schedules`, `GET /api/runs`, `GET /api/scheduler/config`, `GET /api/manual-runs` | Main app shell becomes visible |
| Sign Out | `Sign Out` button in schedules panel | Authenticated admin session | Clears admin state and player/session state | `POST /api/auth/logout` | Login gate reappears |

## Manual Generation

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Toggle Google Search | `Google Search On/Off` | None | Flips local tool option | None until submit | Button label/tone changes |
| Toggle URL Context | `URL Context On/Off` | None | Flips local tool option | None until submit | Button label/tone changes |
| Change model | Model select | None | Updates chosen TTS model | None until submit | Selected option changes |
| Generate prompts | `Generate & Prepare Audio` | Authenticated, prompt text present, no warning lockout | Submits trimmed prompts, queues manual runs, refreshes manual state | `POST /api/manual-runs`, `GET /api/manual-runs` | Results/history/player state updates and activity log grows |

## Tabs

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Switch tab | `results`, `player`, `history`, `schedules`, `runs` buttons | Authenticated | Updates `activeTab` only | None | Corresponding panel is shown |

## History

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Select all | `Select All` | At least one history entry | Selects all current history ids | None | Count reflects all selected |
| Clear selection | `Clear Selection` | Selection exists | Clears selection set | None | Count returns to zero |
| Group checkbox | Day group checkbox | Group exists | Selects or clears that day group | None | Group count and indeterminate state update |
| Item checkbox | Per-entry checkbox | Entry exists | Toggles one entry in selection | None | Entry selected state updates |
| Delete selected | `Delete Selected` | Selection exists | Deletes selected entries that confirm successfully | `DELETE /api/manual-runs/:id`, `DELETE /api/runs/:id` | Entries disappear, selection shrinks |
| Play from history | Per-entry `Play` | Entry playable | Sets target autoplay request and routes to player | May fetch audio artifact later | Player tab opens with selected item |
| Delete entry | Per-entry `Delete` | Entry exists and confirmation accepted | Deletes one entry | `DELETE /api/manual-runs/:id` or `DELETE /api/runs/:id` | Entry disappears |

## Scheduler Config

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Update polling | `Update Polling` | Authenticated, valid interval | Saves scheduler config and refreshes displayed current values | `PUT /api/scheduler/config` | Current polling text updates |
| Refresh schedules | `Refresh schedules` or runs `Refresh` | Authenticated | Refreshes schedules/runs/config | `GET /api/schedules`, `GET /api/runs`, `GET /api/scheduler/config` | Lists and counts update |

## Schedules

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Schedule tool toggles | Search/context toggle buttons in form | None | Flips draft option | None until submit | Button label/tone changes |
| Weekday toggles | `Sun`-`Sat` buttons when weekly | Weekly frequency selected | Updates selected days array | None until submit | Selected day styling changes |
| Create schedule | `Create Schedule` | Authenticated, valid draft | Creates schedule and resets edit state | `POST /api/schedules`, then refresh calls | Schedule appears in list |
| Update schedule | `Update Schedule` | Authenticated, editing existing schedule | Persists update and exits edit mode | `PUT /api/schedules/:id`, then refresh calls | Edited values appear in list/form resets |
| Cancel edit | `Cancel` | Editing or draft open | Clears current edit mode | None | Form returns to create mode |
| Expand prompt | `Expand prompt` / `Collapse prompt` | Prompt preview truncated | Toggles prompt preview state | None | Full prompt visibility changes |
| Expand error | `Show details` / `Hide details` | Error summary present | Toggles error detail state | None | Full error visibility changes |
| Run now | `Run now` | Authenticated | Triggers run and routes to runs tab | `POST /api/schedules/:id/run-now`, then refresh calls | Runs tab opens with updated run list |
| Edit | `Edit` | Schedule exists | Loads schedule into form | None | Form switches to update mode |
| Delete | `Delete` | Schedule exists and confirmation accepted | Deletes schedule and clears edit state if needed | `DELETE /api/schedules/:id`, then refresh calls | Schedule disappears |

## Player

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Select item | Player list item button | Item exists | Updates selected player item and may queue scheduled audio load | `GET /api/artifacts/:path` for some scheduled/manual cases | Details panel updates |
| Toggle item checkbox | Player list checkbox | Item exists | Updates checked item ids | None | Checkbox state changes |
| Play all selected | `Play All Selected` | At least one playable checked item | Builds queue and starts playback | Audio artifact fetch for required segments | Playback state changes |
| Play/Pause | `Play` / `Pause` | Selected playable item | Starts or pauses playback | Audio artifact fetch if audio not cached | Button label changes and progress advances or pauses |
| Stop | `Stop` | None | Clears playback flags and queue | None | Progress resets |
| Download | `Download` | Selected single-file playable item | Opens download link | None | Button enabled only for eligible items |
| Part play | `Play Here` | Selected multipart item | Starts playback from chosen part | Artifact fetch if needed | Current part/playback state updates |
| Part expand | `Expand` / `Collapse` on part text | Part text truncated | Toggles part text clamp | None | Full part text visibility changes |

## Result Cards

| Action | Trigger | Preconditions | Expected state change | Expected API | Expected visible result |
| --- | --- | --- | --- | --- | --- |
| Expand answer | Result card expand/collapse button | Answer text long enough | Toggles local expanded state | None | Full answer visibility changes |

## Drift Checks

- Schedule objects are typed with `timezone`, while some UI rendering currently references `timeZone`; tests must guard the intended display behavior.
- Scheduled cache state persists `'failed'` while the player UI runtime state uses `'error'`; tests should guard visible button behavior instead of relying on raw state names.
