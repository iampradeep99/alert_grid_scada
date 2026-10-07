export class PointProcessor {
  async process({ sourceType, message }) {
    console.log(`[${sourceType}] Point assignment processing`, {
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

export const pointProcessor = new PointProcessor();
