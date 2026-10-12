# Synthetic speech fixtures

These WAV files contain generated speech, not user recordings. They are excluded from the public build.

- `italian.wav`: Italian voice, “Oggi parleremo della Sicilia, una regione nel sud dell’Italia. La capitale è Palermo.”
- `english.wav`: macOS Samantha (US English), 145 words/minute, “Today we will talk about Sicily, a region in southern Italy. The capital is Palermo.”
- `mixed.wav`: first eight seconds of Italian (padded if needed), then English followed by silence to a 20-second total.

Mono 48 kHz PCM16 WAV is used for Chrome synthetic capture and native decoding. Tests resample it to the model’s required 16 kHz. Synthetic capture can loop the input waveform; repeated spoken phrases are legitimate new capture time, not overlapping inference chunks. Recognition is approximate and must be checked against expected language/content.

The MP3, M4A, MP4 and WebM versions are FFmpeg encodings of the English fixture. The codec check exercises native metadata reading, decoding and 16 kHz resampling.
