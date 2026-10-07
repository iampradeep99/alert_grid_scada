export class NmsProcessor {
  async process({ sourceType, message }) {
    console.log(`[${sourceType}] NMS assignment processing`, {
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

export const nmsProcessor = new NmsProcessor();
