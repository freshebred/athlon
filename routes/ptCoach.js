const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const PTConversation = require('../models/PTConversation');
const MealLog = require('../models/MealLog');
const WorkoutLog = require('../models/WorkoutLog');
const DailyBalance = require('../models/DailyBalance');
const User = require('../models/User');
const ScheduledCheckIn = require('../models/ScheduledCheckIn');
const { agentChat, agentChatWithTools, parseAIJson, checkUserInput } = require('../utils/groq');
const { reverseDeduction, addWorkoutCalories, getLocalDate, deductMealCalories, reverseWorkoutCalories } = require('../utils/balance');
const { searchIngredient } = require('../utils/usda');

const LEAK_PATTERNS = [
  /<tool_call>/i,
  /<\/tool_call>/i,
  /\{"(USDA_search|searchUSDA|getRecentMeals|getRecentWorkouts|logFood|getUserInformation|scheduleCheckIn|cancelCheckIn|getActiveCheckIns|reportUnsupportedCapability|tool_call)":/,
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
    .replace(/\{[^{}]*"(USDA_search|searchUSDA|getRecentMeals|getRecentWorkouts|logFood|getUserInformation|scheduleCheckIn|cancelCheckIn|getActiveCheckIns|reportUnsupportedCapability)"[^{}]*\}/g, '')
    .trim();
}

let PT_SYSTEM_PROMPT = '';
try {
  PT_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../pt-coach-prompt.md'), 'utf-8');
} catch (err) {
  PT_SYSTEM_PROMPT = 'You are Max, an AI personal trainer and nutrition coach.';
}

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
    ...recentWorkouts.map(w => `- [${w.localDate}] ${w.activityType} ${w.duration}min: ${w.finalCaloriesBurnt ?? w.caloriesBurnt} kcal earned (ID: ${w._id})`),
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
      description: "Search the USDA food database to find calories and macros for a food ingredient. Do NOT use this to search for workouts or exercises.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "getRecentMeals",
      description: "Get user's logged meals for the past N days",
      parameters: { type: "object", properties: { days: { type: "number", description: "Number of past days (max 7)" } }, required: ["days"] }
    }
  },
  {
    type: "function",
    function: {
      name: "getRecentWorkouts",
      description: "Get user's logged workouts for the past N days",
      parameters: { type: "object", properties: { days: { type: "number", description: "Number of past days (max 7)" } }, required: ["days"] }
    }
  },
  {
    type: "function",
    function: {
      name: "getUserInformation",
      description: "Get detailed user profile information (weight, height, goal, activity level)",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "scheduleCheckIn",
      description: "Set a reminder to check in on the user at a future date/time",
      parameters: { type: "object", properties: { message: { type: "string" }, hoursFromNow: { type: "number" } }, required: ["message", "hoursFromNow"] }
    }
  },
  {
    type: "function",
    function: {
      name: "cancelCheckIn",
      description: "Cancel a previously scheduled check-in by ID",
      parameters: { type: "object", properties: { checkInId: { type: "string" } }, required: ["checkInId"] }
    }
  },
  {
    type: "function",
    function: {
      name: "getActiveCheckIns",
      description: "List all active scheduled check-ins for the user",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "reportUnsupportedCapability",
      description: "Use this tool immediately if the user asks you to do something that you do not have a specific capability for (e.g., ordering an uber, playing music). Do NOT use this tool for logging workouts, logging food, or updating user info, as you support those natively via your JSON action response.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }
];

async function executePTTool(toolCall, user, conversationId) {
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
      return JSON.stringify(meals.map(m => ({ name: m.name, calories: m.totalCalories, date: m.localDate })));
    }
    if (name === 'getRecentWorkouts') {
      const days = Math.min(Number(args.days) || 1, 7);
      const workouts = await WorkoutLog.find({ userId: user._id })
        .sort({ loggedAt: -1 }).limit(days * 5);
      return JSON.stringify(workouts.map(w => ({ activity: w.activityType, caloriesBurnt: w.finalCaloriesBurnt, date: w.localDate })));
    }
    if (name === 'getUserInformation') {
      return JSON.stringify(user.profile);
    }
    if (name === 'scheduleCheckIn') {
      if (args.hoursFromNow == null || !args.message) {
        return JSON.stringify({ error: 'Missing required arguments: message, hoursFromNow' });
      }
      const date = new Date(Date.now() + (args.hoursFromNow * 60 * 60 * 1000));
      const checkIn = new ScheduledCheckIn({ userId: user._id, message: args.message, scheduledFor: date, conversationId });
      await checkIn.save();
      return JSON.stringify({ success: true, checkInId: checkIn._id, scheduledFor: date });
    }
    if (name === 'cancelCheckIn') {
      if (!args.checkInId) {
        return JSON.stringify({ error: 'Missing required argument: checkInId' });
      }
      await ScheduledCheckIn.deleteOne({ _id: args.checkInId, userId: user._id });
      return JSON.stringify({ success: true });
    }
    if (name === 'getActiveCheckIns') {
      const checkIns = await ScheduledCheckIn.find({ userId: user._id, status: 'pending' });
      return JSON.stringify(checkIns.map(c => ({ id: c._id, message: c.message, scheduledFor: c.scheduledFor })));
    }
    if (name === 'reportUnsupportedCapability') {
      return JSON.stringify({ error: "Unsupported Capability", message: "Tell the user you do not have the capability to do that right now." });
    }
  } catch (err) {
    return JSON.stringify({ error: 'media_unavailable', details: err.message });
  }
  return JSON.stringify({ error: 'media_unavailable', details: 'Unknown tool' });
}

// ── Exported helpers ────────────────────────────────────────────────────────
module.exports.parsePTResponse = parsePTResponse;

function parsePTResponse(rawResponse) {
  const cleaned = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }

  if (!parsed || typeof parsed.message !== 'string') {
    return { userMessage: rawResponse.trim(), decision: { type: 'none', approved: false, caloriesAdjusted: null, note: null, resolved: false } };
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
      data:              action.data              || {},
      resolved:          action.type !== 'none' && action.type !== undefined
    }
  };
}

// Applies changes to DB when user APPROVES a pending action
async function applyPendingAction(actionRecord, conversation, user) {
  const decision = actionRecord.data;
  const type = actionRecord.type;
  const localDate = getLocalDate(user.profile?.timezone);

  if (type === 'approve_meal_delete') {
    const meal = await MealLog.findOne({ _id: conversation.context.referenceId, userId: user._id });
    if (!meal) throw new Error('Meal not found');
    const oldCals = meal.totalCalories;
    meal.isDeleted = true;
    meal.deletedAt = new Date();
    meal.ptDeleteApproved = true;
    meal.deleteReason = decision.note || 'PT approved';
    await meal.save();
    await reverseDeduction(user._id, meal.localDate, oldCals);
    return { action: 'meal_deleted', caloriesRestored: oldCals };
  }

  if (type === 'approve_meal_edit') {
    const meal = await MealLog.findOne({ _id: conversation.context.referenceId, userId: user._id });
    if (!meal) throw new Error('Meal not found');
    if (decision.caloriesAdjusted == null) throw new Error('No new calorie value provided');
    const oldCals = meal.totalCalories;
    const diff = decision.caloriesAdjusted - oldCals;
    meal.editHistory.push({ editedAt: new Date(), previousCalories: oldCals, ptApproved: true, ptNote: decision.note });
    meal.totalCalories = decision.caloriesAdjusted;
    await meal.save();
    if (diff < 0) await reverseDeduction(user._id, meal.localDate, Math.abs(diff));
    else if (diff > 0) await deductMealCalories(user._id, meal.localDate, diff);
    return { action: 'meal_edited', oldCalories: oldCals, newCalories: decision.caloriesAdjusted };
  }

  if (type === 'approve_ingredient_edit') {
    const meal = await MealLog.findOne({ _id: conversation.context.referenceId, userId: user._id });
    if (!meal) throw new Error('Meal not found');
    const ingredientIndex = meal.ingredients.findIndex(i => i.name.toLowerCase() === decision.ingredientName.toLowerCase());
    if (ingredientIndex === -1) throw new Error('Ingredient not found');
    const oldCals = meal.totalCalories;
    meal.ingredients[ingredientIndex].calories = decision.ingredientCalories;
    meal.ingredients[ingredientIndex].amount = decision.ingredientAmount;
    const newTotalCals = meal.ingredients.reduce((sum, i) => sum + i.calories, 0);
    const diff = newTotalCals - oldCals;
    meal.editHistory.push({ editedAt: new Date(), previousCalories: oldCals, ptApproved: true, ptNote: decision.note });
    meal.totalCalories = newTotalCals;
    await meal.save();
    if (diff < 0) await reverseDeduction(user._id, meal.localDate, Math.abs(diff));
    else if (diff > 0) await deductMealCalories(user._id, meal.localDate, diff);
    return { action: 'ingredient_edited', oldCalories: oldCals, newCalories: newTotalCals };
  }

  if (type === 'approve_workout_adjust') {
    const workout = await WorkoutLog.findOne({ _id: conversation.context.referenceId, userId: user._id });
    if (!workout) throw new Error('Workout not found');
    if (decision.caloriesAdjusted == null) throw new Error('No new calorie value provided');
    const oldBurnt = workout.finalCaloriesBurnt ?? workout.caloriesBurnt;
    const diff = decision.caloriesAdjusted - oldBurnt;
    workout.ptAdjustment = diff;
    workout.finalCaloriesBurnt = decision.caloriesAdjusted;
    workout.ptDisputed = true;
    workout.ptConversationId = conversation._id;
    await workout.save();
    if (diff > 0) await addWorkoutCalories(user._id, workout.localDate, diff);
    else if (diff < 0) await reverseWorkoutCalories(user._id, workout.localDate, Math.abs(diff));
    return { action: 'workout_adjusted', oldCalories: oldBurnt, newCalories: decision.caloriesAdjusted };
  }

  if (type === 'log_food') {
    const meal = await MealLog.findOne({ _id: decision.draftDocId });
    if (meal) {
      meal.status = 'approved';
      await meal.save();
    }
    await deductMealCalories(user._id, localDate, decision.data.calories);
    return { action: 'food_logged' };
  }

  if (type === 'redirect_to_earn') {
    return { action: 'redirected_to_earn' };
  }

  if (type === 'update_user_info') {
    if (decision.data.weight) user.profile.weight = decision.data.weight;
    if (decision.data.goal) user.profile.goal = decision.data.goal;
    user.profile.tdee = user.calculateTDEE();
    await user.save();
    return { action: 'user_info_updated' };
  }

  return { action: 'unknown' };
}

// ── ROUTES ──────────────────────────────────────────────────────────────────

router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, conversationId, context } = req.body;
    const user = req.user;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    try {
      const safeCheck = await checkUserInput(message.trim());
      if (!safeCheck.safe) return res.status(400).json({ error: 'Invalid input detected.' });
    } catch (err) {}

    let conversation = conversationId ? await PTConversation.findOne({ _id: conversationId, userId: user._id }) : null;
    if (!conversation) {
      conversation = new PTConversation({
        userId: user._id,
        context: context || { type: 'general' },
        messages: [{ role: 'user', content: message }]
      });
    } else {
      // Auto-reject any stale pending actions when user continues chatting
      for (const action of conversation.pendingActions) {
        if (action.status === 'pending') {
          action.status = 'rejected';
          if (action.data && action.data.draftDocId) {
            if (action.type === 'log_food') {
              MealLog.updateOne({ _id: action.data.draftDocId }, { status: 'rejected' }).exec();
            }
          }
        }
      }
      conversation.messages.push({ role: 'user', content: message });
    }
    conversation.lastMessageAt = new Date();

    const userContext = await buildUserContext(user._id, user.profile?.timezone);
    const fullSystem = `${PT_SYSTEM_PROMPT}\n\n---\n\n${userContext}\n\nThe user's name is ${user.name}. Address them by name when appropriate.`;

    let historyMessages = conversation.messages.slice(-20).map(m => {
      const msg = { role: m.role, content: m.content || '' };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.name) msg.name = m.name;
      return msg;
    });

    let finalResponseText = '';
    let toolLoop = true;
    let uiToolCalls = [];
    let toolErrors = [];
    while (toolLoop) {
      const response = await agentChatWithTools(historyMessages, fullSystem, PT_TOOLS, 1024);
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolMsg = { role: 'assistant', content: response.content || '', tool_calls: response.tool_calls };
        historyMessages.push(toolMsg);
        conversation.messages.push(toolMsg);
        for (const call of response.tool_calls) {
          uiToolCalls.push({ name: call.function.name, args: call.function.arguments });
          const result = await executePTTool(call, user, conversation._id);
          if (result.includes('"media_unavailable"')) toolErrors.push("media_unavailable");
          const resultMsg = { role: 'tool', content: result, tool_call_id: call.id, name: call.function.name };
          historyMessages.push(resultMsg);
          conversation.messages.push(resultMsg);
        }
      } else {
        finalResponseText = response.content || '';
        toolLoop = false;
      }
    }

    if (hasLeakedInternals(finalResponseText)) {
      try {
        const retryResponse = await agentChatWithTools(historyMessages, fullSystem, PT_TOOLS, 1024);
        if (!retryResponse.tool_calls || retryResponse.tool_calls.length === 0) {
          finalResponseText = sanitiseAIResponse(retryResponse.content || finalResponseText);
        }
      } catch (e) { finalResponseText = sanitiseAIResponse(finalResponseText); }
    }

    const { userMessage, decision } = parsePTResponse(finalResponseText);
    conversation.messages.push({ role: 'assistant', content: userMessage });

    if (decision && decision.type !== 'none' && decision.type !== 'deny') {
      const localDate = getLocalDate(user.profile?.timezone);
      if (decision.type === 'log_food') {
        const meal = new MealLog({
          userId: user._id,
          name: decision.data.name,
          logType: 'manual',
          ingredients: decision.data.ingredients || [],
          totalCalories: decision.data.calories,
          totalProtein: decision.data.protein || 0,
          totalCarbs: decision.data.carbs || 0,
          totalFat: decision.data.fat || 0,
          aiVerdict: 'Logged by PT Coach',
          localDate,
          status: 'draft',
          ai_generated: true,
          ai_metadata: { decision }
        });
        await meal.save();
        decision.draftDocId = meal._id;
        decision.draftDoc = meal.toObject();
      } else if (decision.type === 'redirect_to_earn') {
        // No draft document needed, handled fully in client
      }

      conversation.pendingActions.push({
        id: new mongoose.Types.ObjectId().toString(),
        type: decision.type,
        data: decision,
        status: 'pending'
      });
    } else if (decision && decision.type === 'deny' && conversation.context?.type !== 'general') {
      conversation.memoryNote = { summary: decision.note || 'Dispute denied', createdAt: new Date() };
      conversation.resolved = true;
      conversation.resolution = { outcome: 'no_change', note: decision.note, resolvedAt: new Date() };
    }

    await conversation.save();

    res.json({
      message: userMessage,
      conversationId: conversation._id,
      pendingActions: conversation.pendingActions.filter(p => p.status === 'pending'),
      uiToolCalls,
      decision,
      errorFlags: toolErrors
    });
  } catch (err) {
    console.error('[PT Coach /chat] Error:', err);
    res.status(500).json({ error: 'Failed to process PT Coach message.' });
  }
});

router.post('/start-dispute', requireAuth, async (req, res) => {
  // Almost identical to /chat, but sets dispute context.
  try {
    const { referenceId, referenceType, initialMessage } = req.body;
    const user = req.user;

    if (!referenceId || !referenceType || !initialMessage) {
      return res.status(400).json({ error: 'referenceId, referenceType, and initialMessage are required' });
    }

    let referenceData = referenceType === 'MealLog' ? await MealLog.findOne({ _id: referenceId, userId: user._id }) : await WorkoutLog.findOne({ _id: referenceId, userId: user._id });
    if (!referenceData) return res.status(404).json({ error: 'Reference not found' });

    const conversation = new PTConversation({
      userId: user._id,
      context: { type: referenceType === 'MealLog' ? 'dispute_meal' : 'dispute_workout', referenceId, referenceType, initialClaim: initialMessage },
      messages: [{ role: 'user', content: initialMessage }]
    });

    const userContext = await buildUserContext(user._id, user.profile?.timezone);
    const fullSystem = `${PT_SYSTEM_PROMPT}\n\n---\n\n${userContext}\n\nUser ${user.name} is disputing a ${referenceType}. Reference data: ${JSON.stringify(referenceData).substring(0, 500)}`;

    let historyMessages = [{ role: 'user', content: initialMessage }];
    let finalResponseText = '';
    let toolLoop = true;
    let uiToolCalls = [];
    let toolErrors = [];
    
    while (toolLoop) {
      const response = await agentChatWithTools(historyMessages, fullSystem, PT_TOOLS, 1024);
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolMsg = { role: 'assistant', content: response.content || '', tool_calls: response.tool_calls };
        historyMessages.push(toolMsg);
        conversation.messages.push(toolMsg);
        for (const call of response.tool_calls) {
          uiToolCalls.push({ name: call.function.name, args: call.function.arguments });
          const result = await executePTTool(call, user, conversation._id);
          if (result.includes('"media_unavailable"')) toolErrors.push("media_unavailable");
          const resultMsg = { role: 'tool', content: result, tool_call_id: call.id, name: call.function.name };
          historyMessages.push(resultMsg);
          conversation.messages.push(resultMsg);
        }
      } else {
        finalResponseText = response.content || '';
        toolLoop = false;
      }
    }

    const { userMessage, decision } = parsePTResponse(finalResponseText);
    conversation.messages.push({ role: 'assistant', content: userMessage });

    if (decision && decision.type !== 'none' && decision.type !== 'deny') {
      const localDate = getLocalDate(user.profile?.timezone);
      if (decision.type === 'log_food') {
        const meal = new MealLog({
          userId: user._id,
          name: decision.data.name,
          logType: 'manual',
          ingredients: decision.data.ingredients || [],
          totalCalories: decision.data.calories,
          totalProtein: decision.data.protein || 0,
          totalCarbs: decision.data.carbs || 0,
          totalFat: decision.data.fat || 0,
          aiVerdict: 'Logged by PT Coach',
          localDate,
          status: 'draft',
          ai_generated: true,
          ai_metadata: { decision }
        });
        await meal.save();
        decision.draftDocId = meal._id;
        decision.draftDoc = meal.toObject();
      } else if (decision.type === 'redirect_to_earn') {
        // No draft document needed, handled fully in client
      }

      conversation.pendingActions.push({
        id: new mongoose.Types.ObjectId().toString(),
        type: decision.type,
        data: decision,
        status: 'pending'
      });
    } else if (decision && decision.type === 'deny' && conversation.context?.type !== 'general') {
      conversation.memoryNote = { summary: decision.note || 'Dispute denied', createdAt: new Date() };
      conversation.resolved = true;
      conversation.resolution = { outcome: 'no_change', note: decision.note, resolvedAt: new Date() };
    }
    
    conversation.lastMessageAt = new Date();
    await conversation.save();

    res.status(201).json({
      message: userMessage,
      conversationId: conversation._id,
      pendingActions: conversation.pendingActions.filter(p => p.status === 'pending'),
      uiToolCalls,
      decision,
      errorFlags: toolErrors
    });
  } catch (err) {
    console.error('[PT Coach /start-dispute] Error:', err);
    res.status(500).json({ error: 'Failed to start dispute conversation.' });
  }
});

// New Endpoint: Approve Pending Action
router.post('/action/approve', requireAuth, async (req, res) => {
  try {
    const { conversationId, actionId } = req.body;
    const conversation = await PTConversation.findOne({ _id: conversationId, userId: req.user._id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const actionRecord = conversation.pendingActions.find(p => p.id === actionId && p.status === 'pending');
    if (!actionRecord) return res.status(404).json({ error: 'Pending action not found or already processed' });

    const result = await applyPendingAction(actionRecord, conversation, req.user);
    
    actionRecord.status = 'approved';
    conversation.messages.push({ role: 'user', content: '[User approved action]' });
    
    // Resolve dispute memory if applicable
    const decision = actionRecord.data;
    if (decision && decision.note && conversation.context?.type !== 'general') {
      conversation.memoryNote = { summary: decision.note, createdAt: new Date() };
      conversation.resolved = true;
      conversation.resolution = { outcome: 'pt_adjusted', caloriesAdjusted: decision.caloriesAdjusted, note: decision.note, resolvedAt: new Date() };
    }
    
    await conversation.save();

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New Endpoint: Reject Pending Action
router.post('/action/reject', requireAuth, async (req, res) => {
  try {
    const { conversationId, actionId } = req.body;
    const conversation = await PTConversation.findOne({ _id: conversationId, userId: req.user._id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const actionRecord = conversation.pendingActions.find(p => p.id === actionId && p.status === 'pending');
    if (!actionRecord) return res.status(404).json({ error: 'Pending action not found or already processed' });

    actionRecord.status = 'rejected';
    if (actionRecord.data && actionRecord.data.draftDocId) {
      if (actionRecord.type === 'log_food') {
        await MealLog.updateOne({ _id: actionRecord.data.draftDocId }, { status: 'rejected' });
      }
    }
    conversation.messages.push({ role: 'user', content: '[User rejected proposed action]' });
    
    await conversation.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject action' });
  }
});

router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const conversations = await PTConversation.find({ userId: req.user._id }).sort({ lastMessageAt: -1 }).limit(20).select('-messages');
    res.json({ conversations });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch conversations.' }); }
});

router.get('/conversations/:id', requireAuth, async (req, res) => {
  try {
    const conversation = await PTConversation.findOne({ _id: req.params.id, userId: req.user._id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ conversation });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch conversation.' }); }
});

module.exports = router;
