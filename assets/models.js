export const MODEL_CACHE = "studyroom-models-v1";
export const MODELS = [
  {
    key: "fast",
    id: "onnx-community/whisper-tiny",
    revision: "ff4177021cc41f7db950912b73ea4fdf7d01d8e7",
    label: "Fast · Whisper tiny",
    task: "automatic-speech-recognition",
    bytes: 43615928,
    files: [
      {
        path: "config.json",
        bytes: 2243,
      },
      {
        path: "generation_config.json",
        bytes: 3772,
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        bytes: 30719241,
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        bytes: 10124990,
      },
      {
        path: "preprocessor_config.json",
        bytes: 339,
      },
      {
        path: "special_tokens_map.json",
        bytes: 2194,
      },
      {
        path: "tokenizer.json",
        bytes: 2480466,
      },
      {
        path: "tokenizer_config.json",
        bytes: 282683,
      },
    ],
  },
  {
    key: "balanced",
    id: "onnx-community/whisper-base",
    revision: "1846881b6b3a3024392c1eea3ad983695bc23925",
    label: "Balanced · Whisper base",
    task: "automatic-speech-recognition",
    bytes: 79666385,
    files: [
      {
        path: "config.json",
        bytes: 2243,
      },
      {
        path: "generation_config.json",
        bytes: 3832,
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        bytes: 53693315,
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        bytes: 23201314,
      },
      {
        path: "preprocessor_config.json",
        bytes: 339,
      },
      {
        path: "special_tokens_map.json",
        bytes: 2194,
      },
      {
        path: "tokenizer.json",
        bytes: 2480466,
      },
      {
        path: "tokenizer_config.json",
        bytes: 282682,
      },
    ],
  },
  {
    key: "high",
    id: "onnx-community/whisper-small",
    revision: "36050c46d777d46dc4b5f43f6d90574fc38f8732",
    label: "High accuracy · Whisper small",
    task: "automatic-speech-recognition",
    bytes: 251848807,
    files: [
      {
        path: "config.json",
        bytes: 2227,
      },
      {
        path: "generation_config.json",
        bytes: 3893,
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        bytes: 156750845,
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        bytes: 92326160,
      },
      {
        path: "preprocessor_config.json",
        bytes: 339,
      },
      {
        path: "special_tokens_map.json",
        bytes: 2194,
      },
      {
        path: "tokenizer.json",
        bytes: 2480466,
      },
      {
        path: "tokenizer_config.json",
        bytes: 282683,
      },
    ],
  },
  {
    key: "it-en",
    id: "Xenova/opus-mt-it-en",
    revision: "fd0b89b9c052adc1f2f64152f555aa17353728be",
    label: "Italian → English",
    task: "translation",
    bytes: 136865467,
    files: [
      {
        path: "config.json",
        bytes: 1376,
      },
      {
        path: "generation_config.json",
        bytes: 293,
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        bytes: 68147852,
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        bytes: 60773278,
      },
      {
        path: "special_tokens_map.json",
        bytes: 74,
      },
      {
        path: "tokenizer.json",
        bytes: 7942314,
      },
      {
        path: "tokenizer_config.json",
        bytes: 280,
      },
    ],
  },
  {
    key: "en-it",
    id: "Xenova/opus-mt-en-it",
    revision: "075406e3c8c2c30634d4a1bd8f00c21d9e162011",
    label: "English → Italian",
    task: "translation",
    bytes: 136474118,
    files: [
      {
        path: "config.json",
        bytes: 1376,
      },
      {
        path: "generation_config.json",
        bytes: 293,
      },
      {
        path: "onnx/decoder_model_merged_quantized.onnx",
        bytes: 67970348,
      },
      {
        path: "onnx/encoder_model_quantized.onnx",
        bytes: 60597150,
      },
      {
        path: "special_tokens_map.json",
        bytes: 74,
      },
      {
        path: "tokenizer.json",
        bytes: 7904597,
      },
      {
        path: "tokenizer_config.json",
        bytes: 280,
      },
    ],
  },
];
export const modelURL = (model, file) =>
  `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`;
