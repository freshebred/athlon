const { reasoningChat } = require('./utils/groq');

async function run() {
  console.log("Testing reasoningChat...");
  try {
    const res = await reasoningChat([{role: 'user', content: 'List all possible ingredients for: "dumplings"'}], "Respond with JSON array");
    console.log("RESPONSE LENGTH:", res.length);
    console.log(res);
  } catch(e) {
    console.error("ERROR:", e.message);
  }
}
run();
