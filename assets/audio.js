export function resample(samples, rate, target = 16000) {
  if (rate === target) return samples;
  const length = Math.floor((samples.length * target) / rate),
    result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = (i * rate) / target,
      start = Math.floor(position),
      fraction = position - start;
    result[i] =
      samples[start] * (1 - fraction) +
      (samples[Math.min(start + 1, samples.length - 1)] || 0) * fraction;
  }
  return result;
}
export function wavBlob(samples, rate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const write = (offset, text) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(
      44 + i * 2,
      Math.max(-1, Math.min(1, samples[i])) * 32767,
      true,
    );
  return new Blob([buffer], { type: "audio/wav" });
}
export async function decodeAudio(file) {
  const limit =
    (navigator.deviceMemory && navigator.deviceMemory <= 4 ? 40 : 100) *
    1024 *
    1024;
  if (file.size > limit)
    throw new Error(
      `This file exceeds the ${limit / 1024 / 1024} MB safe decoding limit. Split it into shorter recordings before importing.`,
    );
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > 3600)
      throw new Error(
        "Split recordings longer than one hour into smaller files.",
      );
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++)
        mono[i] += channel[i] / buffer.numberOfChannels;
    }
    return resample(mono, buffer.sampleRate);
  } catch (e) {
    if (/limit|Split/.test(e.message)) throw e;
    throw new Error(
      "This browser could not decode the recording. Try WAV or MP3, or a shorter file.",
    );
  } finally {
    await context.close();
  }
}
export class Microphone {
  constructor(onSamples) {
    this.onSamples = onSamples;
    this.active = false;
    this.stream = null;
    this.context = null;
  }
  async start() {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Microphone recording needs HTTPS or localhost and a supported browser.",
      );
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this.context = new AudioContext();
      await this.context.audioWorklet.addModule(
        new URL("./audio-worklet.js", import.meta.url),
      );
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, "studyroom-capture");
      this.node.port.onmessage = (event) => {
        if (this.active)
          this.onSamples(resample(event.data, this.context.sampleRate));
      };
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.source
        .connect(this.node)
        .connect(this.gain)
        .connect(this.context.destination);
      this.active = true;
      await this.context.resume();
    } catch (e) {
      await this.stop();
      throw new Error(
        e.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser’s site settings."
          : e.message,
      );
    }
  }
  pause() {
    this.active = false;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = false));
  }
  resume() {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = true));
    this.active = true;
    this.context?.resume();
  }
  async stop() {
    this.active = false;
    this.node?.disconnect();
    this.source?.disconnect();
    this.gain?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.context && this.context.state !== "closed")
      await this.context.close();
    this.stream = null;
    this.context = null;
  }
}
export async function audioDuration(file) {
  const audio = new Audio();
  audio.preload = "metadata";
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error("Audio metadata could not load. Try WAV or MP3.")),
        15000,
      );
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(audio.duration);
      };
      audio.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "This browser cannot decode the audio format. Try WAV or MP3.",
          ),
        );
      };
      audio.src = url;
    });
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
// Long files use the browser's streaming codec decoder, so PCM memory stays bounded.
// They process at playback speed and pause when inference needs to catch up.
export class FileCapture {
  constructor(file, onSamples, onEnded) {
    this.file = file;
    this.onSamples = onSamples;
    this.onEnded = onEnded;
    this.active = false;
    this.context = null;
    this.audio = null;
  }
  async prepare() {
    this.context = new AudioContext();
    this.audio = new Audio();
    this.url = URL.createObjectURL(this.file);
    this.audio.src = this.url;
    this.audio.preload = "auto";
    await this.context.audioWorklet.addModule(
      new URL("./audio-worklet.js", import.meta.url),
    );
    this.source = this.context.createMediaElementSource(this.audio);
    this.node = new AudioWorkletNode(this.context, "studyroom-capture");
    this.node.port.onmessage = (e) => {
      if (this.active)
        this.onSamples(resample(e.data, this.context.sampleRate));
    };
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.source
      .connect(this.node)
      .connect(this.gain)
      .connect(this.context.destination);
    this.audio.onended = () => {
      this.active = false;
      this.onEnded();
    };
    await this.context.resume();
    await this.audio.play();
    this.audio.pause();
    this.audio.currentTime = 0;
  }
  async start() {
    this.active = true;
    await this.context.resume();
    await this.audio.play();
  }
  pause() {
    this.active = false;
    this.audio.pause();
  }
  async resume() {
    this.active = true;
    await this.audio.play();
  }
  async stop() {
    this.active = false;
    this.audio?.pause();
    this.node?.disconnect();
    this.source?.disconnect();
    this.gain?.disconnect();
    if (this.context && this.context.state !== "closed")
      await this.context.close();
    if (this.audio) {
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
  }
}
