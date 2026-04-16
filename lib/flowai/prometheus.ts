import {
  getFlowAiCircuitSnapshot,
  getFlowAiInfraSnapshot,
  getFlowAiObservabilitySnapshot,
} from "./infra";
import { getFlowAiJobQueueSnapshot } from "./jobs";

function escapeLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function metricLine(
  name: string,
  value: number,
  labels?: Record<string, string | number | boolean | null | undefined>,
) {
  const safeValue = Number.isFinite(value) ? value : 0;
  if (!labels || Object.keys(labels).length === 0) {
    return `${name} ${safeValue}`;
  }

  const renderedLabels = Object.entries(labels)
    .filter(([, labelValue]) => labelValue !== null && labelValue !== undefined)
    .map(([key, labelValue]) => `${key}="${escapeLabelValue(String(labelValue))}"`)
    .join(",");

  return `${name}{${renderedLabels}} ${safeValue}`;
}

export async function buildFlowAiPrometheusMetrics() {
  const infra = getFlowAiInfraSnapshot();
  const observability = getFlowAiObservabilitySnapshot();
  const circuits = await getFlowAiCircuitSnapshot();
  const jobs = await getFlowAiJobQueueSnapshot();

  const lines: string[] = [];

  lines.push("# HELP flowai_requests_total Total de requests observadas pelo FlowAI.");
  lines.push("# TYPE flowai_requests_total counter");
  lines.push(metricLine("flowai_requests_total", observability.counters.requestsTotal));
  lines.push(metricLine("flowai_success_total", observability.counters.successTotal));
  lines.push(metricLine("flowai_failed_total", observability.counters.failedTotal));
  lines.push(metricLine("flowai_cache_hit_total", observability.counters.cacheHitTotal));
  lines.push(metricLine("flowai_queued_total", observability.counters.queuedTotal));
  lines.push(
    metricLine(
      "flowai_replay_blocked_total",
      observability.counters.replayBlockedTotal,
    ),
  );
  lines.push(
    metricLine(
      "flowai_rate_limited_total",
      observability.counters.rateLimitedTotal,
    ),
  );
  lines.push(
    metricLine(
      "flowai_circuit_opened_total",
      observability.counters.circuitOpenedTotal,
    ),
  );

  lines.push("# HELP flowai_provider_requests_total Requests por provider/model.");
  lines.push("# TYPE flowai_provider_requests_total gauge");
  for (const provider of observability.providers) {
    const [providerKey, ...modelParts] = String(provider.key).split(":");
    const model = modelParts.join(":");
    lines.push(
      metricLine("flowai_provider_requests_total", provider.requests, {
        provider: providerKey,
        model,
      }),
    );
    lines.push(
      metricLine("flowai_provider_successes_total", provider.successes, {
        provider: providerKey,
        model,
      }),
    );
    lines.push(
      metricLine("flowai_provider_failures_total", provider.failures, {
        provider: providerKey,
        model,
      }),
    );
    lines.push(
      metricLine("flowai_provider_avg_latency_ms", provider.avgLatencyMs || 0, {
        provider: providerKey,
        model,
      }),
    );
  }

  lines.push("# HELP flowai_circuit_state Estado do circuit breaker por provider.");
  lines.push("# TYPE flowai_circuit_state gauge");
  for (const circuit of circuits) {
    lines.push(
      metricLine(
        "flowai_circuit_state",
        circuit.state === "open" ? 2 : circuit.state === "half_open" ? 1 : 0,
        {
          provider: circuit.provider,
          state: circuit.state,
          mode: circuit.mode,
        },
      ),
    );
    lines.push(
      metricLine(
        "flowai_circuit_consecutive_failures",
        circuit.consecutiveFailures,
        { provider: circuit.provider },
      ),
    );
    lines.push(
      metricLine(
        "flowai_circuit_consecutive_successes",
        circuit.consecutiveSuccesses,
        { provider: circuit.provider },
      ),
    );
  }

  lines.push("# HELP flowai_queue_jobs Quantidade de jobs externos por estado.");
  lines.push("# TYPE flowai_queue_jobs gauge");
  lines.push(metricLine("flowai_queue_jobs", jobs.pending, { status: "pending" }));
  lines.push(
    metricLine("flowai_queue_jobs", jobs.processing, { status: "processing" }),
  );
  lines.push(
    metricLine("flowai_queue_jobs", jobs.completed, { status: "completed" }),
  );
  lines.push(metricLine("flowai_queue_jobs", jobs.failed, { status: "failed" }));
  lines.push(metricLine("flowai_queue_oldest_pending_age_ms", jobs.oldestPendingAgeMs));

  for (const group of infra.queue.groups) {
    lines.push(
      metricLine("flowai_local_queue_active", group.active, { queue: group.key }),
    );
    lines.push(
      metricLine("flowai_local_queue_pending", group.pending, { queue: group.key }),
    );
    lines.push(
      metricLine("flowai_local_queue_processed", group.processed, {
        queue: group.key,
      }),
    );
    lines.push(
      metricLine("flowai_local_queue_avg_wait_ms", group.avgWaitMs, {
        queue: group.key,
      }),
    );
  }

  lines.push(
    metricLine(
      "flowai_redis_configured",
      infra.redis.configured ? 1 : 0,
      { mode: infra.redis.mode },
    ),
  );

  return lines.join("\n") + "\n";
}
