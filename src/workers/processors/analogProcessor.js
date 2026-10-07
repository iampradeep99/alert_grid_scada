export class AnalogProcessor {
  async process({ sourceType, message }) {
    console.log(`[${sourceType}] Analog assignment processing`, {
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

export const analogProcessor = new AnalogProcessor();
