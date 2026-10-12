class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.used = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      let value = 0;
      for (const ch of channels) value += ch[i];
      this.buffer[this.used++] = value / channels.length;
      if (this.used === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(4096);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("studyroom-capture", CaptureProcessor);
