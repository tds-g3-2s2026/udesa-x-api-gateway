import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';

import { app } from './app';
import { startTelemetry } from './telemetry';

// Telemetry leaves the pod only when an endpoint is set. The exporters read it,
// and the rest of the OTEL_EXPORTER_OTLP_* variables, on their own.
const telemetry = startTelemetry(
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? { spans: new OTLPTraceExporter(), logs: new OTLPLogExporter() }
    : undefined
);

// Kubernetes sends SIGTERM before stopping the pod: the last batches go out
// before the process exits.
process.on('SIGTERM', async () => {
  await Promise.all([telemetry?.tracerProvider.shutdown(), telemetry?.loggerProvider.shutdown()]);
  process.exit(0);
});

const port = Number(process.env.PORT ?? 8000);

// Bun's own runner starts an HTTP server from this shape when the file is
// run directly (`bun run src/index.ts`); nothing extra needed to listen.
export default {
  port,
  fetch: app.fetch,
};
