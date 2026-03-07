// Unified AI Service Layer — provider-agnostic client-side AI calls
// All calls go directly from the browser to the user-configured provider endpoint.

const DEFAULT_CONFIG = {
  enabled: false,
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  baseUrl: '',
  features: {
    voiceTaskInput: true,
    morningSummary: true,
    eveningReflection: true,
    weeklySummary: true,
    smartScheduling: true,
    durationEstimate: true,
    frameNudge: true,
    aiReschedule: true,
  }
};

const PROVIDER_MODELS = {
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', recommended: true },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5-20250514', label: 'Claude Haiku 4.5', recommended: true },
    { id: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', recommended: true },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
    { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro' },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2', recommended: true },
    { id: 'mistral', label: 'Mistral' },
    { id: 'gemma2', label: 'Gemma 2' },
  ],
  custom: [],
};

const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  ollama: 'Ollama (Local)',
  custom: 'Custom (OpenAI-compatible)',
};

// Load config from localStorage
export function loadAIConfig() {
  try {
    const raw = localStorage.getItem('day-planner-ai-config');
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed, features: { ...DEFAULT_CONFIG.features, ...parsed.features } };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

// Save config to localStorage
export function saveAIConfig(config) {
  localStorage.setItem('day-planner-ai-config', JSON.stringify(config));
}

// Get base URL for a provider
function getBaseUrl(config) {
  switch (config.provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'gemini':
      return `https://generativelanguage.googleapis.com/v1beta/models/${config.model}`;
    case 'ollama':
      return config.baseUrl || 'http://localhost:11434';
    case 'custom':
      return config.baseUrl || '';
    default:
      return '';
  }
}

// Retry a fetch-based operation with exponential backoff for transient errors
// (500, 502, 503, 504, 429, network failures). Retries up to 3 times.
async function withRetry(fn, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable =
        err.name === 'TypeError' ||                     // network failure / fetch error
        /\b(500|502|503|504|529)\b/.test(err.message) ||  // server errors
        /\b429\b/.test(err.message) ||                  // rate limit
        /overloaded/i.test(err.message);
      if (!isRetryable || attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); // 1s, 2s, 4s
    }
  }
  throw lastError;
}

// Make a completion request to the configured provider (with automatic retry)
export async function aiComplete(systemPrompt, userMessage, config) {
  if (!config?.enabled || !config.apiKey && config.provider !== 'ollama') {
    throw new Error('AI is not configured');
  }

  return withRetry(() => _aiComplete(systemPrompt, userMessage, config));
}

async function _aiComplete(systemPrompt, userMessage, config) {
  const { provider, apiKey, model } = config;

  switch (provider) {
    case 'openai':
    case 'custom': {
      const base = provider === 'custom' ? (config.baseUrl || '') : 'https://api.openai.com/v1';
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI API error: ${res.status}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content == null) throw new Error('Unexpected response format from OpenAI API');
      return content;
    }

    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userMessage },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Anthropic API error: ${res.status}`);
      }
      const data = await res.json();
      const text = data.content?.[0]?.text;
      if (text == null) throw new Error('Unexpected response format from Anthropic API');
      return text;
    }

    case 'gemini': {
      const base = getBaseUrl(config);
      const res = await fetch(`${base}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.3 },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini API error: ${res.status}`);
      }
      const data = await res.json();
      const geminiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (geminiText == null) throw new Error('Unexpected response format from Gemini API');
      return geminiText;
    }

    case 'ollama': {
      const base = config.baseUrl || 'http://localhost:11434';
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: false,
        }),
      });
      if (!res.ok) {
        throw new Error(`Ollama error: ${res.status}`);
      }
      const data = await res.json();
      return data.message.content;
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Request JSON-structured output from the AI — parses and validates the response
export async function aiJSON(systemPrompt, userMessage, config) {
  const raw = await aiComplete(systemPrompt, userMessage, config);
  // Extract JSON from the response (handles ```json fences and bare JSON)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!jsonMatch) {
    throw new Error('AI response did not contain valid JSON');
  }
  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    throw new Error('Failed to parse AI JSON response');
  }
}

// Check if a provider supports audio transcription
export function supportsTranscription(config) {
  return ['openai', 'custom', 'gemini'].includes(config?.provider);
}

// Transcribe audio using the configured AI provider
// Uses OpenAI Whisper API for openai/custom, Gemini multimodal for gemini
export async function aiTranscribe(audioBlob, config) {
  if (!config?.enabled || (!config.apiKey && config.provider !== 'ollama')) {
    throw new Error('AI is not configured');
  }

  return withRetry(() => _aiTranscribe(audioBlob, config));
}

async function _aiTranscribe(audioBlob, config) {
  const { provider, apiKey, model } = config;

  switch (provider) {
    case 'openai':
    case 'custom': {
      const base = provider === 'custom' ? (config.baseUrl || '') : 'https://api.openai.com/v1';
      const ext = audioBlob.type?.includes('mp4') ? 'mp4' : 'webm';
      const formData = new FormData();
      formData.append('file', audioBlob, `recording.${ext}`);
      formData.append('model', 'whisper-1');
      const res = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Transcription API error: ${res.status}`);
      }
      const data = await res.json();
      return data.text;
    }

    case 'gemini': {
      const buffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
      const res = await fetch(`${base}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: audioBlob.type || 'audio/webm', data: base64 } },
              { text: 'Transcribe this audio recording exactly as spoken. Return only the transcription text, nothing else.' }
            ]
          }]
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini transcription error: ${res.status}`);
      }
      const data = await res.json();
      const transcribedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (transcribedText == null) throw new Error('Unexpected response format from Gemini transcription API');
      return transcribedText;
    }

    default:
      throw new Error(`${PROVIDER_LABELS[provider] || provider} does not support audio transcription. Use the text input instead.`);
  }
}

// Test connection to the configured provider
export async function testConnection(config) {
  try {
    const result = await aiComplete(
      'You are a helpful assistant. Respond with exactly: "Connection successful"',
      'Test',
      { ...config, enabled: true }
    );
    return { success: true, message: result.trim() };
  } catch (err) {
    const isOllama = config.provider === 'ollama';
    const isNetworkError = err.message === 'Failed to fetch' || err.name === 'TypeError';
    return {
      success: false,
      message: err.message,
      ollamaHelp: isOllama && isNetworkError
        ? 'Could not reach Ollama. Make sure it\'s running and CORS is enabled for this origin. See setup guide →'
        : isOllama && !isNetworkError
        ? err.message
        : null,
    };
  }
}

export { DEFAULT_CONFIG, PROVIDER_MODELS, PROVIDER_LABELS };
