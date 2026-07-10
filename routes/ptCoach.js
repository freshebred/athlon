const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const PTConversation = require('../models/PTConversation');
const MealLog = require('../models/MealLog');
const WorkoutLog = require('../models/WorkoutLog');
const DailyBalance = require('../models/DailyBalance');
const { agentChat, agentChatWithTools, parseAIJson, checkUserInput } = require('../utils/groq');
const { reverseDeduction, addWorkoutCalories, getLocalDate, deductMealCalories } = require('../utils/balance');
const { searchIngredient } = require('../utils/usda');

// ── Inline pure helpers (NOT exported from groq so they are never mocked) ──
const LEAK_PATTERNS = [
  /<tool_call>/i,
  /<\/tool_call>/i,
  /\{"(USDA_search|searchUSDA|getRecentMeals|getRecentWorkouts|logFood|tool_call)":/,
  /\[TOOL_CALL\]/i,
  /"tool_calls"\s*:/,
  /\btool_call_id\b/
];
function hasLeakedInternals(text) {
  if (!text) return false;
  return LEAK_PATTERNS.some(p => p.test(text));
}
function sanitiseAIResponse(text) {
  if (!text) return text;
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, '')
    .replace(/```tool_code[\s\S]*?```/gi, '')
    .replace(/\{[^{}]*"(USDA_search|searchUSDA|getRecentMeals|getRecentWorkouts|logFood)"[^{}]*\}/g, '')
    .trim();
}


// Load PT Coach system prompt from markdown file
let PT_SYSTEM_PROMPT = '';
try {
  PT_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../pt-coach-prompt.md'), 'utf-8');
} catch (err) {
  PT_SYSTEM_PROMPT = 'You are Max, an AI personal trainer and nutrition coach. Be helpful, motivating, and fair when resolving calorie disputes.';
}

/**
 * Build context string from user's current data to inject into PT Coach system prompt
 */
async function buildUserContext(userId, timezone) {
  const localDate = getLocalDate(timezone);

  const [todayBalance, recentMeals, recentWorkouts, recentConversations] = await Promise.all([
    DailyBalance.findOne({ userId, localDate }),
    MealLog.find({ userId, isDeleted: false }).sort({ loggedAt: -1 }).limit(10),
    WorkoutLog.find({ userId }).sort({ loggedAt: -1 }).limit(5),
    PTConversation.find({ userId, 'memoryNote.summary': { $exists: true } })
      .sort({ lastMessageAt: -1 })
      .limit(10)
      .select('memoryNote context.type sessionStartedAt')
  ]);

  const contextLines = [
    `## Current User Context (${new Date().toISOString()})`,
    `Today's Date (User Local): ${localDate}`,
    '',
    '### Daily Balance',
    todayBalance ? `- Opening Balance: $${todayBalance.openingBalance} (${todayBalance.openingBalance} kcal TDEE)` : '- No balance data for today',
    todayBalance ? `- Current Balance: $${todayBalance.currentBalance.toFixed(0)}` : '',
    todayBalance ? `- Consumed: ${todayBalance.caloriesConsumed} kcal` : '',
    todayBalance ? `- Earned from workouts: ${todayBalance.caloriesBurnt} kcal` : '',
    todayBalance?.carryover ? `- Carryover from yesterday: ${todayBalance.carryover} kcal` : '',
    '',
    '### Recent Meals (last 10)',
    ...recentMeals.map(m => `- [${m.localDate}] ${m.name}: ${m.totalCalories} kcal (ID: ${m._id})`),
    '',
    '### Recent Workouts (last 5)',
    ...recentWorkouts.map(w => `- [${w.localDate}] ${w.activityType} ${w.duration}min: ${w.finalCaloriesBurnt || w.caloriesBurnt} kcal earned (ID: ${w._id})`),
    '',
    '### PT Memory Notes (past resolutions)',
    ...recentConversations.map(c => `- [${c.sessionStartedAt?.toISOString().split('T')[0]}] ${c.context?.type}: ${c.memoryNote?.summary}`)
  ];

  return contextLines.filter(l => l !== undefined).join('\n');
}

const PT_TOOLS = [
  {
    type: "function",
    function: {
      name: "searchUSDA",
      description: "Search the USDA food database to find calories and macros for an ingredient",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getRecentMeals",
      description: "Get user's logged meals for the past N days",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "Number of past days (max 7)" } },
        required: ["days"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getRecentWorkouts",
      description: "Get user's logged workouts for the past N days",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "Number of past days (max 7)" } },
        required: ["days"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "logFood",
      description: "Log a food item into the user's meals for today on their behalf. Use this ONLY if the user explicitly asks you to log it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          calories: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
          ingredients: {
            type: "array",
            description: "Detailed list of ingredients in the meal. Always include this.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amount: { type: "number", description: "Amount in grams" },
                calories: { type: "number" },
                protein: { type: "number" },
                carbs: { type: "number" },
                fat: { type: "number" }
              },
              required: ["name", "amount", "calories"]
            }
          }
        },
        required: ["name", "calories", "ingredients"]
      }
    }
  }
];

async function executePTTool(toolCall, user) {
  const name = toolCall.function.name;
  let args = {};
  try { args = JSON.parse(toolCall.function.arguments); } catch(e){}

  try {
    if (name === 'searchUSDA') {
      const res = await searchIngredient(args.query);
      return JSON.stringify(res || { error: 'Not found' });
    }
    if (name === 'getRecentMeals') {
      const days = Math.min(Number(args.days) || 1, 7);
      const meals = await MealLog.find({ userId: user._id, isDeleted: false })
        .sort({ loggedAt: -1 }).limit(days * 10);
      return JSON.stringify(meals.map(m => ({
        name: m.name, calories: m.totalCalories, date: m.localDate
      })));
    }
    if (name === 'getRecentWorkouts') {
      const days = Math.min(Number(args.days) || 1, 7);
      const workouts = await WorkoutLog.find({ userId: user._id })
        .sort({ loggedAt: -1 }).limit(days * 5);
      return JSON.stringify(workouts.map(w => ({
        activity: w.activityType, caloriesBurnt: w.finalCaloriesBurnt, date: w.localDate
      })));
    }
    if (name === 'logFood') {
      const localDate = getLocalDate(user.profile?.timezone);
      const ingredients = Array.isArray(args.ingredients) ? args.ingredients.map(i => ({
        name: i.name || 'Unknown',
        amount: Number(i.amount) || 1,
        unit: 'g',
        calories: Number(i.calories) || 0,
        protein: Number(i.protein) || 0,
        carbs: Number(i.carbs) || 0,
        fat: Number(i.fat) || 0,
        verified: false
      })) : [{ name: args.name, amount: 1, unit: 'serving', calories: args.calories, protein: args.protein || 0, carbs: args.carbs || 0, fat: args.fat || 0, verified: false }];

      const meal = new MealLog({
        userId: user._id,
        name: args.name,
        logType: 'manual',
        ingredients,
        totalCalories: args.calories,
        totalProtein: args.protein || 0,
        totalCarbs: args.carbs || 0,
        totalFat: args.fat || 0,
        aiVerdict: 'Logged by PT Coach',
        localDate
      });
      await meal.save();
      await deductMealCalories(user._id, localDate, args.calories);
      return JSON.stringify({ success: true, message: `Logged ${args.name} for ${args.calories} cals.` });
    }
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
  return JSON.stringify({ error: 'Unknown tool' });
}

// ── POST /api/pt-coach/chat ─────────────────────────────────────────────────
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, conversationId, context } = req.body;
    const user = req.user;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Safeguard: check for prompt injection (fail-open on error)
    try {
      const safeCheck = await checkUserInput(message.trim());
      if (!safeCheck.safe) {
        return res.status(400).json({ error: 'Invalid input detected.' });
      }
    } catch (safeguardErr) {
      console.warn('[PT-COACH] Safeguard check failed (fail-open):', safeguardErr.message);
      // Fail open — allow the message through
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await PTConversation.findOne({ _id: conversationId, userId: user._id });
    }

    if (!conversation) {
      conversation = new PTConversation({
        userId: user._id,
        context: context || { type: 'general' },
        messages: []
      });
    }

    // Add user message
    conversation.messages.push({ role: 'user', content: message });
    conversation.lastMessageAt = new Date();

    // Build full system prompt with user context
    const userContext = await buildUserContext(user._id, user.profile?.timezone);
    const fullSystem = `${PT_SYSTEM_PROMPT}\n\n---\n\n${userContext}\n\nThe user's name is ${user.name}. Address them by name when appropriate.`;

    // Build message history for AI (limit to last 20 for context window)
    let historyMessages = conversation.messages
      .slice(-20)
      .map(m => {
        const msg = { role: m.role, content: m.content || '' };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        return msg;
      });

    let finalResponseText = '';
    let toolLoop = true;
    let uiToolCalls = [];
    while (toolLoop) {
      const response = await agentChatWithTools(historyMessages, fullSystem, PT_TOOLS, 1024);
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolMsg = { role: 'assistant', content: response.content || '', tool_calls: response.tool_calls };
        historyMessages.push(toolMsg);
        conversation.messages.push(toolMsg);
        
        for (const call of response.tool_calls) {
          uiToolCalls.push({ name: call.function.name, args: call.function.arguments });
          const result = await executePTTool(call, user);
          const resultMsg = { role: 'tool', content: result, tool_call_id: call.id, name: call.function.name };
          historyMessages.push(resultMsg);
          conversation.messages.push(resultMsg);
        }
      } else {
        finalResponseText = response.content || '';
        toolLoop = false;
      }
    }

    // Detect leaked internals in the final text response; retry once if found
    if (hasLeakedInternals(finalResponseText)) {
      console.warn('[PT-COACH] Leaked internals in chat response, retrying...');
      try {
        const retryResponse = await agentChatWithTools(historyMessages, fullSystem, PT_TOOLS, 1024);
        if (!retryResponse.tool_calls || retryResponse.tool_calls.length === 0) {
          finalResponseText = sanitiseAIResponse(retryResponse.content || finalResponseText);
        }
      } catch (retryErr) {
        console.error('[PT-COACH] Retry failed:', retryErr.message);
        finalResponseText = sanitiseAIResponse(finalResponseText);
      }
    }

    // Parse structured JSON verdict from PT Coach
    const { userMessage, decision } = parsePTResponse(finalResponseText);

    // Add the user-facing message to conversation
    conversation.messages.push({ role: 'assistant', content: userMessage });

    // Handle PT decisions
    let actionResult = null;
    if (decision && conversation.context?.referenceId) {
      actionResult = await handlePTDecision(decision, conversation, user);
    }

    // Save conversation
    await conversation.save();

    // Generate memory note if conversation resolved a dispute
    if (decision?.note && decision?.type !== 'none' && conversation.context?.type !== 'general') {
      conversation.memoryNote = { summary: decision.note, createdAt: new Date() };
      conversation.resolved = decision.approved || decision.type === 'deny';
      conversation.resolution = {
        outcome: decision.approved ? 'pt_adjusted' : 'no_change',
        caloriesAdjusted: decision.caloriesAdjusted,
        note: decision.note,
        resolvedAt: new Date()
      };
      await conversation.save();
    }

    res.json({
      message: userMessage,
      conversationId: conversation._id,
      decision,
      actionResult,
      uiToolCalls
    });
  } catch (err) {
    console.error('[PT-COACH] Chat error:', err.message);
    res.status(500).json({ error: 'Failed to process PT Coach message.' });
  }
});

// ── Exported helpers ────────────────────────────────────────────────────────
module.exports.parsePTResponse = parsePTResponse;

/**
 * Parse structured JSON verdict from PT Coach response.
 * Returns { userMessage, decision } where decision follows the action schema.
 * Falls back gracefully if JSON parsing fails.
 */
function parsePTResponse(rawResponse) {
  // Strip markdown code fences if present
  const cleaned = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract first JSON object from the text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }

  // If parsing completely failed, return the raw text as a general message
  if (!parsed || typeof parsed.message !== 'string') {
    return {
      userMessage: rawResponse.trim(),
      decision: { type: 'none', approved: false, caloriesAdjusted: null, ingredientName: null, ingredientCalories: null, ingredientAmount: null, note: null }
    };
  }

  const action = parsed.action || {};
  return {
    userMessage: parsed.message,
    decision: {
      type:              action.type              || 'none',
      approved:          action.approved          ?? false,
      caloriesAdjusted:  action.caloriesAdjusted  ?? null,
      ingredientName:    action.ingredientName    ?? null,
      ingredientCalories:action.ingredientCalories?? null,
      ingredientAmount:  action.ingredientAmount  ?? null,
      note:              action.note              ?? null,
      // Derived helpers used by handlePTDecision
      resolved: action.type !== 'none' && action.type !== undefined
    }
  };
}

/**
 * Apply PT decision to the referenced meal or workout.
 * Uses the explicit decision.type from the structured JSON verdict.
 */
async function handlePTDecision(decision, conversation, user) {
  const { type, caloriesAdjusted, ingredientName, ingredientCalories, ingredientAmount, note } = decision;
  const { referenceId, referenceType } = conversation.context;

  // Nothing to do for non-action types
  if (!type || type === 'none' || type === 'deny') {
    return type === 'deny' ? { action: 'denied' } : null;
  }

  if (!referenceId) return null;

  try {
    const localDate = getLocalDate(user.profile?.timezone);

    // ── Meal deletion ──────────────────────────────────────────
    if (type === 'approve_meal_delete') {
      const meal = await MealLog.findOne({ _id: referenceId, userId: user._id });
      if (!meal) return { action: 'error', reason: 'Meal not found' };

      const oldCals = meal.totalCalories;
      meal.isDeleted = true;
      meal.deletedAt = new Date();
      meal.ptDeleteApproved = true;
      meal.deleteReason = note || 'PT approved';
      await meal.save();
      await reverseDeduction(user._id, meal.localDate, oldCals);
      return { action: 'meal_deleted', caloriesRestored: oldCals };
    }

    // ── Meal calorie edit ──────────────────────────────────────
    if (type === 'approve_meal_edit') {
      const meal = await MealLog.findOne({ _id: referenceId, userId: user._id });
      if (!meal) return { action: 'error', reason: 'Meal not found' };
      if (!caloriesAdjusted) return { action: 'error', reason: 'No new calorie value provided' };

      const oldCals = meal.totalCalories;
      const diff = caloriesAdjusted - oldCals;
      meal.editHistory.push({ editedAt: new Date(), previousCalories: oldCals, ptApproved: true, ptNote: note });
      meal.totalCalories = caloriesAdjusted;
      await meal.save();

      if (diff < 0) await reverseDeduction(user._id, meal.localDate, Math.abs(diff));
      else if (diff > 0) {
        // Extra consumed — deduct more
        const { deductMealCalories } = require('../utils/balance');
        await deductMealCalories(user._id, meal.localDate, diff);
      }
      return { action: 'meal_edited', oldCalories: oldCals, newCalories: caloriesAdjusted };
    }

    // ── Ingredient calorie edit ──────────────────────────────────────
    if (type === 'approve_ingredient_edit') {
      const meal = await MealLog.findOne({ _id: referenceId, userId: user._id });
      if (!meal) return { action: 'error', reason: 'Meal not found' };
      if (!ingredientName || ingredientCalories == null || ingredientAmount == null) return { action: 'error', reason: 'Missing ingredient update data' };

      const ingredientIndex = meal.ingredients.findIndex(i => i.name.toLowerCase() === ingredientName.toLowerCase());
      if (ingredientIndex === -1) return { action: 'error', reason: 'Ingredient not found in meal' };

      const oldCals = meal.totalCalories;
      meal.ingredients[ingredientIndex].calories = ingredientCalories;
      meal.ingredients[ingredientIndex].amount = ingredientAmount;
      
      const newTotalCals = meal.ingredients.reduce((sum, i) => sum + i.calories, 0);
      const diff = newTotalCals - oldCals;
      
      meal.editHistory.push({ editedAt: new Date(), previousCalories: oldCals, ptApproved: true, ptNote: note });
      meal.totalCalories = newTotalCals;
      await meal.save();

      if (diff < 0) await reverseDeduction(user._id, meal.localDate, Math.abs(diff));
      else if (diff > 0) {
        const { deductMealCalories } = require('../utils/balance');
        await deductMealCalories(user._id, meal.localDate, diff);
      }
      return { action: 'ingredient_edited', oldCalories: oldCals, newCalories: newTotalCals, updatedIngredient: ingredientName };
    }

    // ── Workout calorie adjustment ─────────────────────────────
    if (type === 'approve_workout_adjust') {
      const workout = await WorkoutLog.findOne({ _id: referenceId, userId: user._id });
      if (!workout) return { action: 'error', reason: 'Workout not found' };
      if (!caloriesAdjusted) return { action: 'error', reason: 'No new calorie value provided' };

      const oldBurnt = workout.finalCaloriesBurnt || workout.caloriesBurnt;
      const diff = caloriesAdjusted - oldBurnt;
      workout.ptAdjustment = diff;
      workout.finalCaloriesBurnt = caloriesAdjusted;
      workout.ptDisputed = true;
      workout.ptConversationId = conversation._id;
      await workout.save();

      if (diff > 0) await addWorkoutCalories(user._id, workout.localDate, diff);
      else if (diff < 0) await reverseDeduction(user._id, workout.localDate, Math.abs(diff));

      return { action: 'workout_adjusted', oldCalories: oldBurnt, newCalories: caloriesAdjusted };
    }

  } catch (err) {
    console.error('[PT-COACH] Decision action error:', err.message);
  }

  return null;
}



// ── GET /api/pt-coach/conversations ────────────────────────────────────────
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const conversations = await PTConversation.find({ userId: req.user._id })
      .sort({ lastMessageAt: -1 })
      .limit(20)
      .select('-messages');

    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

// ── GET /api/pt-coach/conversations/:id ────────────────────────────────────
router.get('/conversations/:id', requireAuth, async (req, res) => {
  try {
    const conversation = await PTConversation.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    res.json({ conversation });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation.' });
  }
});

// ── POST /api/pt-coach/start-dispute ───────────────────────────────────────
// Start a dispute conversation for a specific meal or workout
router.post('/start-dispute', requireAuth, async (req, res) => {
  try {
    const { referenceId, referenceType, initialMessage } = req.body;
    const user = req.user;

    if (!referenceId || !referenceType || !initialMessage) {
      return res.status(400).json({ error: 'referenceId, referenceType, and initialMessage are required' });
    }

    // Validate the reference exists
    let referenceData = null;
    if (referenceType === 'MealLog') {
      referenceData = await MealLog.findOne({ _id: referenceId, userId: user._id });
    } else if (referenceType === 'WorkoutLog') {
      referenceData = await WorkoutLog.findOne({ _id: referenceId, userId: user._id });
    }

    if (!referenceData) return res.status(404).json({ error: 'Reference not found' });

    const contextType = referenceType === 'MealLog' ? 'dispute_meal' : 'dispute_workout';

    const conversation = new PTConversation({
      userId: user._id,
      context: {
        type: contextType,
        referenceId,
        referenceType,
        initialClaim: initialMessage
      },
      messages: []
    });

    // First message from user
    conversation.messages.push({ role: 'user', content: initialMessage });

    // Build context and get PT response
    const userContext = await buildUserContext(user._id, user.profile?.timezone);
    const fullSystem = `${PT_SYSTEM_PROMPT}\n\n---\n\n${userContext}\n\nUser ${user.name} is disputing a ${referenceType}. Reference data: ${JSON.stringify(referenceData).substring(0, 500)}`;

    let historyMessages = [{ role: 'user', content: initialMessage }];
    let finalResponseText = '';
    let toolLoop = true;
    let uiToolCalls = [];
    
    while (toolLoop) {
      const response = await agentChatWithTools(historyMessages, fullSystem, PT_TOOLS, 1024);
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolMsg = { role: 'assistant', content: response.content || '', tool_calls: response.tool_calls };
        historyMessages.push(toolMsg);
        conversation.messages.push(toolMsg);
        
        for (const call of response.tool_calls) {
          uiToolCalls.push({ name: call.function.name, args: call.function.arguments });
          const result = await executePTTool(call, user);
          const resultMsg = { role: 'tool', content: result, tool_call_id: call.id, name: call.function.name };
          historyMessages.push(resultMsg);
          conversation.messages.push(resultMsg);
        }
      } else {
        finalResponseText = response.content || '';
        toolLoop = false;
      }
    }

    // Detect leaked internals; retry once if found
    if (hasLeakedInternals(finalResponseText)) {
      console.warn('[PT-COACH] Leaked internals in start-dispute response, retrying...');
      try {
        const retryResponse = await agentChatWithTools(historyMessages, fullSystem, PT_TOOLS, 1024);
        if (!retryResponse.tool_calls || retryResponse.tool_calls.length === 0) {
          finalResponseText = sanitiseAIResponse(retryResponse.content || finalResponseText);
        }
      } catch (retryErr) {
        console.error('[PT-COACH] start-dispute retry failed:', retryErr.message);
        finalResponseText = sanitiseAIResponse(finalResponseText);
      }
    }

    const { userMessage, decision } = parsePTResponse(finalResponseText);

    conversation.messages.push({ role: 'assistant', content: userMessage });
    conversation.lastMessageAt = new Date();

    // Handle PT decisions if made immediately in the first response
    let actionResult = null;
    if (decision && conversation.context?.referenceId) {
      actionResult = await handlePTDecision(decision, conversation, user);
    }

    await conversation.save();

    // Generate memory note if conversation resolved a dispute
    if (decision?.note && decision?.type !== 'none' && conversation.context?.type !== 'general') {
      conversation.memoryNote = { summary: decision.note, createdAt: new Date() };
      conversation.resolved = decision.approved || decision.type === 'deny';
      conversation.resolution = {
        outcome: decision.approved ? 'pt_adjusted' : 'no_change',
        caloriesAdjusted: decision.caloriesAdjusted,
        note: decision.note,
        resolvedAt: new Date()
      };
      await conversation.save();
    }

    res.status(201).json({
      message: userMessage,
      conversationId: conversation._id,
      decision,
      actionResult,
      uiToolCalls
    });
  } catch (err) {
    console.error('[PT-COACH] Start dispute error:', err.message);
    res.status(500).json({ error: 'Failed to start dispute conversation.' });
  }
});

module.exports = router;
