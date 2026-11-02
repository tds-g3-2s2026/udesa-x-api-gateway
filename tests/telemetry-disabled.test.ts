import { expect, it } from 'vitest';

import { createApp } from '../src/app';
import { startTelemetry } from '../src/telemetry';

it('serves requests without creating export providers when no exporters are configured', async () => {
  expect(startTelemetry()).toBeUndefined();
  expect((await createApp().request('/healthcheck')).status).toBe(200);
  expect((await createApp().request('/unmatched')).status).toBe(404);
});
