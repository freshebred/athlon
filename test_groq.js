require('dotenv').config();
const { agentChatWithTools } = require('./utils/groq');

async function run() {
  try {
    const messages = [{ role: 'user', content: 'hello' }];
    const tools = [{
      type: "function",
      function: {
        name: "testTool",
        description: "test",
        parameters: { type: "object", properties: {}, required: [] }
      }
    }];
    const res = await agentChatWithTools(messages, 'system prompt', tools);
    console.log('Success:', res);
  } catch (err) {
    console.error('Error:', err);
  }
}
run();
