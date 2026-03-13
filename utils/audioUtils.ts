export const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
};

export const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
};

// Decodes raw PCM audio data manually
// Gemini TTS returns raw PCM 16-bit, 24kHz, Mono
export const decodeAudioData = async (
  base64Data: string,
  audioContext: AudioContext,
  log: (msg: string) => void
): Promise<AudioBuffer> => {
  try {
    const SAMPLE_RATE = 24000;
    const NUM_CHANNELS = 1;

    log(`[AudioUtils] Converting base64 string (len: ${base64Data.length}) to Uint8Array...`);
    const uint8Array = base64ToUint8Array(base64Data);
    
    log(`[AudioUtils] Raw data size: ${uint8Array.byteLength} bytes. Processing as raw PCM (Int16, ${SAMPLE_RATE}Hz, Mono)...`);

    // Create Int16 view of the raw bytes
    const dataInt16 = new Int16Array(uint8Array.buffer);
    const frameCount = dataInt16.length / NUM_CHANNELS;
    
    log(`[AudioUtils] Creating AudioBuffer with ${frameCount} frames...`);
    
    // Create an AudioBuffer
    const buffer = audioContext.createBuffer(NUM_CHANNELS, frameCount, SAMPLE_RATE);

    // Fill the buffer by converting Int16 to Float32
    for (let channel = 0; channel < NUM_CHANNELS; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        // Normalize 16-bit integer (-32768 to 32767) to float (-1.0 to 1.0)
        channelData[i] = dataInt16[i * NUM_CHANNELS + channel] / 32768.0;
      }
    }
    
    log(`[AudioUtils] PCM Decoding successful. Duration: ${buffer.duration.toFixed(2)}s`);
    
    return buffer;
  } catch (e: any) {
    log(`[AudioUtils] Decoding Failed: ${e.message}`);
    console.error(e);
    throw e;
  }
};

export const mergeAudioBuffers = (
  audioContext: AudioContext,
  buffers: AudioBuffer[],
  log: (msg: string) => void
): AudioBuffer => {
  if (!buffers.length) {
    throw new Error('No audio buffers to merge');
  }

  const sampleRate = buffers[0].sampleRate;
  const numberOfChannels = buffers[0].numberOfChannels;
  const totalLength = buffers.reduce((sum, buffer) => {
    if (buffer.sampleRate !== sampleRate) {
      throw new Error(`Sample rate mismatch while merging audio: expected ${sampleRate}, got ${buffer.sampleRate}`);
    }
    if (buffer.numberOfChannels !== numberOfChannels) {
      throw new Error(`Channel mismatch while merging audio: expected ${numberOfChannels}, got ${buffer.numberOfChannels}`);
    }
    return sum + buffer.length;
  }, 0);

  log(`[Merge] Creating merged AudioBuffer from ${buffers.length} chunk(s), ${totalLength} frames total.`);
  const merged = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate);
  let offset = 0;

  for (const [bufferIndex, buffer] of buffers.entries()) {
    log(`[Merge] Appending chunk ${bufferIndex + 1}/${buffers.length} (${buffer.duration.toFixed(2)}s).`);
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      merged.getChannelData(channel).set(buffer.getChannelData(channel), offset);
    }
    offset += buffer.length;
  }

  log(`[Merge] Audio merge complete. Duration: ${merged.duration.toFixed(2)}s.`);
  return merged;
};

export const audioBufferToPcmBase64 = (buffer: AudioBuffer): string => {
  const numChannels = buffer.numberOfChannels;
  const pcm = new Int16Array(buffer.length * numChannels);
  const channels = Array.from({ length: numChannels }, (_, index) => buffer.getChannelData(index));
  let offset = 0;

  for (let frameIndex = 0; frameIndex < buffer.length; frameIndex += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frameIndex]));
      pcm[offset] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7FFF);
      offset += 1;
    }
  }

  return uint8ArrayToBase64(new Uint8Array(pcm.buffer));
};

// Convert an AudioBuffer into a WAV Blob (16-bit PCM)
export const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLength = buffer.length * blockAlign;
  const totalLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Write interleaved PCM samples
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
};
