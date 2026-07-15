import { Pool } from 'pg';
import { Transporter } from 'nodemailer';

export interface NotificationMessage {
  notificationId: string;
  eventId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface UserContact {
  userId: string;
  email?: string;
  phone?: string;
  name: string;
}

export class NotificationChannelAdapters {
  constructor(
    private readonly pool: Pool,
    private readonly authServiceUrl: string,
    private readonly internalServiceToken: string,
    private readonly emailTransport?: Transporter,
    private readonly emailFrom?: string,
    private readonly pushWebhookUrl?: string,
    private readonly pushWebhookToken?: string,
    private readonly smsWebhookUrl?: string,
    private readonly smsWebhookToken?: string,
  ) {}

  private async begin(notificationId: string, channel: 'EMAIL' | 'PUSH' | 'SMS'): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status, attempts)
       VALUES ($1, $2, 'PROCESSING', 1)
       ON CONFLICT (notification_id, channel) DO UPDATE SET
         status = 'PROCESSING',
         attempts = notification_deliveries.attempts + 1,
         last_error = NULL,
         updated_at = NOW()
       WHERE notification_deliveries.status IN ('PENDING', 'FAILED')
          OR (notification_deliveries.status = 'PROCESSING'
              AND notification_deliveries.updated_at < NOW() - INTERVAL '5 minutes')
       RETURNING status`,
      [notificationId, channel],
    );
    return result.rows.length === 1;
  }

  private async sent(notificationId: string, channel: 'EMAIL' | 'PUSH' | 'SMS', providerId?: string): Promise<void> {
    await this.pool.query(
      `UPDATE notification_deliveries
       SET status = 'SENT', provider_id = $3, delivered_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE notification_id = $1 AND channel = $2`,
      [notificationId, channel, providerId ?? null],
    );
  }

  private async failed(notificationId: string, channel: 'EMAIL' | 'PUSH' | 'SMS', error: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE notification_deliveries SET status = 'FAILED', last_error = $3, updated_at = NOW()
       WHERE notification_id = $1 AND channel = $2`,
      [notificationId, channel, error instanceof Error ? error.message : String(error)],
    );
  }

  private async contact(userId: string): Promise<UserContact> {
    const response = await fetch(`${this.authServiceUrl}/internal/users/${encodeURIComponent(userId)}/contact`, {
      headers: { 'x-internal-service-token': this.internalServiceToken },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Unable to resolve contact for user ${userId}`);
    const body = await response.json() as { data?: UserContact };
    if (!body.data?.userId) throw new Error(`User ${userId} has no contact record`);
    return body.data;
  }

  async email(message: NotificationMessage): Promise<void> {
    if (!this.emailTransport || !this.emailFrom) throw new Error('SMTP adapter is not configured');
    if (!(await this.begin(message.notificationId, 'EMAIL'))) return;
    try {
      const contact = await this.contact(message.userId);
      if (!contact.email) throw new Error(`User ${message.userId} has no email address`);
      const result = await this.emailTransport.sendMail({
        from: this.emailFrom,
        to: { name: contact.name, address: contact.email },
        subject: message.title,
        text: message.body,
      });
      await this.sent(message.notificationId, 'EMAIL', result.messageId);
    } catch (error) {
      await this.failed(message.notificationId, 'EMAIL', error);
      throw error;
    }
  }

  async push(message: NotificationMessage): Promise<void> {
    if (!this.pushWebhookUrl) throw new Error('Push adapter is not configured');
    if (!(await this.begin(message.notificationId, 'PUSH'))) return;
    try {
      const response = await fetch(this.pushWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.pushWebhookToken ? { authorization: `Bearer ${this.pushWebhookToken}` } : {}),
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Push gateway returned HTTP ${response.status}`);
      await this.sent(message.notificationId, 'PUSH', response.headers.get('x-message-id') ?? undefined);
    } catch (error) {
      await this.failed(message.notificationId, 'PUSH', error);
      throw error;
    }
  }

  async sms(message: NotificationMessage): Promise<void> {
    if (!this.smsWebhookUrl) throw new Error('SMS adapter is not configured');
    if (!(await this.begin(message.notificationId, 'SMS'))) return;
    try {
      const contact = await this.contact(message.userId);
      if (!contact.phone) throw new Error(`User ${message.userId} has no phone number`);
      const response = await fetch(this.smsWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.smsWebhookToken ? { authorization: `Bearer ${this.smsWebhookToken}` } : {}),
        },
        body: JSON.stringify({
          notificationId: message.notificationId,
          eventId: message.eventId,
          to: contact.phone,
          text: message.body,
          type: message.type,
          metadata: message.metadata ?? {},
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`SMS gateway returned HTTP ${response.status}`);
      await this.sent(message.notificationId, 'SMS', response.headers.get('x-message-id') ?? undefined);
    } catch (error) {
      await this.failed(message.notificationId, 'SMS', error);
      throw error;
    }
  }
}
