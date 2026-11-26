/**
 * Runs the ideation model in a Web Worker, entirely in the browser, with
 * Transformers.js on WebGPU. Nothing the user types leaves their machine; the only
 * network traffic is downloading the model weights (once, then cached) and the
 * ONNX runtime.
 *
 * Model: LFM3-1.7B (Liquid AI), 4-bit ONNX build. Chosen for the best instruction
 * following and structured output among browser-ready models, a 256K-token context
 * window (it reads every section of the problem), and a ~1.1 GB download.
 *
 * Messages in:  { type: 'load', device?: 'webgpu' | 'wasm', dtype?: 'q4f16' | 'q4' }
 *               { type: 'generate', id, messages, options }
 *               { type: 'interrupt' }
 * Messages out: { type: 'progress', loaded, total, file }
 *               { type: 'ready', device } | { type: 'error', message }
 *               { type: 'token', id, text } | { type: 'done', id, text }
 */
import { pipeline, TextStreamer, InterruptableStoppingCriteria, type TextGenerationPipeline } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/LFM3-1.7B-ONNX';

let generator: TextGenerationPipeline | null = null;
let loading: Promise<void> | null = null;
const stopping = new InterruptableStoppingCriteria();

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

async function load(device: 'webgpu' | 'wasm', dtype: 'q4f16' | 'q4') {
  generator = (await pipeline('text-generation', MODEL_ID, {
    // q4f16 needs WebGPU with 16-bit float support; otherwise q4.
    dtype,
    device,
    progress_callback: (p: { status: string; loaded?: number; total?: number; file?: string }) => {
      if (p.status === 'progress_total') post({ type: 'progress', loaded: p.loaded, total: p.total });
    },
  })) as TextGenerationPipeline;
  // Warm up once so the first real answer doesn't pay for shader compilation.
  await generator([{ role: 'user', content: 'Hi' }], { max_new_tokens: 1, tokenizer_encode_kwargs: { enable_thinking: false } } as never);
  post({ type: 'ready', device });
}

self.addEventListener('message', async (ev: MessageEvent) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      loading ??= load(msg.device ?? 'webgpu', msg.dtype ?? 'q4f16');
      await loading;
    } else if (msg.type === 'interrupt') {
      stopping.interrupt();
    } else if (msg.type === 'generate') {
      if (!generator) throw new Error('The model is not loaded yet.');
      stopping.reset();
      let text = '';
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (t: string) => { text += t; post({ type: 'token', id: msg.id, text: t }); },
      });
      const o = msg.options ?? {};
      await generator(msg.messages, {
        max_new_tokens: o.max_new_tokens ?? 700,
        // The model card's recommended settings for chat and agents.
        do_sample: true,
        temperature: o.temperature ?? 0.1,
        top_k: 50,
        repetition_penalty: 1.1,
        tokenizer_encode_kwargs: { enable_thinking: !!o.think },
        streamer,
        stopping_criteria: stopping,
      } as never);
      post({ type: 'done', id: msg.id, text });
    }
  } catch (e) {
    // Only a failed load should allow another load attempt.
    if (msg.type === 'load') loading = null;
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
});
