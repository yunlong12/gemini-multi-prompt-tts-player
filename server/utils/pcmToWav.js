export function pcmBase64ToWavBuffer(base64Data, options = {}) {
  const sampleRate = options.sampleRate || 24000;
  const numChannels = options.numChannels || 1;
  const bitsPerSample = options.bitsPerSample || 16;
  const pcmBuffer = Buffer.from(base64Data, 'base64');
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataLength = pcmBuffer.length;
  const totalLength = 44 + dataLength;
  const wavBuffer = Buffer.alloc(totalLength);

  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataLength, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataLength, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}
