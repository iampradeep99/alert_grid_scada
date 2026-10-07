export class AlarmProcessor {
  async process({ sourceType, message }) {
    console.log(`[${sourceType}] Alarm assignment processing`, {
      channel: message.channel,
      payload: message.payload,
      receivedAt: message.receivedAt,
    });

    return {
      sourceType,
      status: 'processed',
      processedAt: new Date().toISOString(),
    };
  }
}

export const alarmProcessor = new AlarmProcessor();
