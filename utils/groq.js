require('dotenv').config();
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Model constants
const MODELS = {
  vision: 'meta-llama/llama-4-scout-17b-16e-instruct',
  reasoning: 'openai/gpt-oss-120b',
  agent: 'llama-3.3-70b-versatile'
};

/**
 * Call the vision model (llama-4-scout) with an image
 * @param {string} base64Image - Base64 encoded image
 * @param {string} mimeType - Image MIME type (image/jpeg, image/png, etc.)
 * @param {string} prompt - Text prompt
 * @returns {string} Model response text
 */
async function analyzeImage(base64Image, mimeType, prompt) {
  const response = await groq.chat.completions.create({
    model: MODELS.vision,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ]
    }],
    max_tokens: 1024,
    temperature: 0.2
  });
  return response.choices[0]?.message?.content || '';
}

/**
 * Call the reasoning model (gpt-oss-120b) for complex assessment tasks
 * @param {Array} messages - Chat messages array
 * @param {string} systemPrompt - System prompt
 * @returns {string} Model response text
 */
async function reasoningChat(messages, systemPrompt) {
  const response = await groq.chat.completions.create({
    model: MODELS.reasoning,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    max_tokens: 2048,
    temperature: 0.3
  });
  return response.choices[0]?.message?.content || '';
}

/**
 * Call the main agent model (llama-3.3-70b) for general tasks
 * @param {Array} messages - Chat messages array
 * @param {string} systemPrompt - System prompt
 * @param {number} maxTokens - Max tokens for response
 * @returns {string} Model response text
 */
async function agentChat(messages, systemPrompt, maxTokens = 1024) {
  const response = await groq.chat.completions.create({
    model: MODELS.agent,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    max_tokens: maxTokens,
    temperature: 0.5
  });
  return response.choices[0]?.message?.content || '';
}

/**
 * Call the agent model with tools enabled
 * @param {Array} messages - Chat messages array
 * @param {string} systemPrompt - System prompt
 * @param {Array} tools - Array of tool definitions
 * @param {number} maxTokens - Max tokens
 * @returns {Object} The complete message object (content, tool_calls, etc)
 */
async function agentChatWithTools(messages, systemPrompt, tools, maxTokens = 1024) {
  const payload = {
    model: MODELS.agent,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    tools: tools,
    tool_choice: 'auto',
    max_tokens: maxTokens,
    temperature: 0.5
  };
  const response = await groq.chat.completions.create(payload);
  return response.choices[0]?.message;
}

/**
 * Parse JSON from AI response (handles markdown code blocks)
 * @param {string} text - AI response text
 * @returns {*} Parsed JSON or null
 */
function parseAIJson(text) {
  try {
    // Remove markdown code blocks if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object/array from text
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch { return null; }
    }
    return null;
  }
}

module.exports = {
  groq,
  MODELS,
  analyzeImage,
  reasoningChat,
  agentChat,
  agentChatWithTools,
  parseAIJson
};
