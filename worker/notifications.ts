export type OpsEventPayload = {
  event: string;
  message: string;
  metadata?: Record<string, unknown>;
};

function nowIso() {
  return new Date().toISOString();
}

export function logStructuredEvent(payload: OpsEventPayload) {
  const record = {
    ...payload,
    timestamp: nowIso(),
  };
  console.log(JSON.stringify(record));
}

export async function notifyOps(env: any, payload: OpsEventPayload) {
  const timestamp = nowIso();
  const record = { ...payload, timestamp };
  const webhookUrl = env.OPS_WEBHOOK_URL;
  const slackWebhook = env.OPS_SLACK_WEBHOOK_URL;
  const emailWebhook = env.OPS_EMAIL_WEBHOOK_URL;
  const emailTo = env.OPS_EMAIL_TO;

  const tasks: Promise<unknown>[] = [];

  if (webhookUrl && typeof webhookUrl === "string") {
    tasks.push(
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      }).catch((error) => {
        console.error("ops webhook notify failed", error);
      })
    );
  }

  if (slackWebhook && typeof slackWebhook === "string") {
    const slackBody = {
      text: `[${payload.event}] ${payload.message}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${payload.event}*\n${payload.message}`,
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `발생 시각: ${timestamp}` }],
        },
      ],
    };
    tasks.push(
      fetch(slackWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackBody),
      }).catch((error) => {
        console.error("ops slack notify failed", error);
      })
    );
  }

  if (emailWebhook && typeof emailWebhook === "string" && emailTo) {
    const emailBody = {
      to: emailTo,
      subject: `[OPS] ${payload.event}`,
      body: `${payload.message}\n\n${JSON.stringify(payload.metadata || {}, null, 2)}`,
      payload: record,
    };
    tasks.push(
      fetch(emailWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailBody),
      }).catch((error) => {
        console.error("ops email notify failed", error);
      })
    );
  }

  if (tasks.length) {
    await Promise.all(tasks);
  }
}
