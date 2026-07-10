const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const { agentChat, parseAIJson } = require('../utils/groq');
const { getLocalDate } = require('../utils/balance');

/**
 * Onboarding uses a conversational AI chat approach.
 * The AI collects: name (already known), age, weight, height, sex,
 * activity level, goal, timezone, and meal reminder times.
 * Once all data is collected, it calls the finalize function.
 */
const ONBOARDING_SYSTEM = `You are Athlon's onboarding assistant. Your job is to warmly and conversationally collect the following information from the new user through a friendly chat interface:

1. Age (years)
2. Weight (kg or lbs - ask their preference)
3. Height (cm or ft/in - ask their preference)
4. Biological sex (male/female - needed for TDEE calculation, explain why briefly)
5. Activity level: sedentary (desk job, no exercise), light (1-3 workouts/week), moderate (3-5 workouts/week), active (6-7 workouts/week), very active (physical job + gym)
6. Goal: lose weight, maintain weight, or gain muscle
7. Timezone (ask them their city or country if they don't know)
8. Meal reminder times - by default: breakfast at 10am, lunch at 1pm, dinner at 8pm - ask if they want to customize

Rules:
- Ask ONE question at a time (or at most 2 related questions together)
- Be warm, encouraging, and brief
- When a user gives a value in imperial, silently convert it and acknowledge both
- When you have ALL information collected, respond with ONLY a JSON block (no text before or after) in this exact format:
\`\`\`json
{
  "complete": true,
  "data": {
    "age": 25,
    "weight": 70,
    "height": 175,
    "sex": "male",
    "activityLevel": "moderate",
    "goal": "lose",
    "timezone": "America/Chicago",
    "unitSystem": "metric",
    "notificationTimes": [
      { "hour": 10, "minute": 0, "label": "Breakfast" },
      { "hour": 13, "minute": 0, "label": "Lunch" },
      { "hour": 20, "minute": 0, "label": "Dinner" }
    ]
  }
}
\`\`\`

- If you don't have all information yet, respond normally in text (no JSON).
- Always be encouraging. End your data collection with: "Perfect! You're all set. Let me calculate your daily calorie goal..."

Start with a warm welcome message when the conversation history is empty.`;

// ── POST /api/onboarding/chat ───────────────────────────────────────────────
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    const user = req.user;

    if (user.onboardingComplete) {
      return res.json({ message: 'Onboarding already complete', complete: true });
    }

    // Build conversation history
    const history = user.onboardingMessages || [];

    // Add user message to history
    if (message) {
      history.push({ role: 'user', content: message });
    }

    // Build messages for AI (only role + content)
    const aiMessages = history.map(m => ({ role: m.role, content: m.content }));

    // If no messages yet, start the conversation
    if (aiMessages.length === 0) {
      aiMessages.push({
        role: 'user',
        content: `Hi! I just signed up. My name is ${user.name}.`
      });
    }

    const response = await agentChat(aiMessages, ONBOARDING_SYSTEM, 512, req.user?.email);

    // Check if onboarding is complete (AI returned JSON)
    const parsed = parseAIJson(response);

    if (parsed?.complete === true && parsed?.data) {
      // Finalize onboarding
      const data = parsed.data;

      user.profile = {
        age: data.age,
        weight: data.weight,
        height: data.height,
        sex: data.sex,
        activityLevel: data.activityLevel,
        goal: data.goal,
        timezone: data.timezone || 'America/Chicago',
        unitSystem: data.unitSystem || 'metric'
      };

      // Calculate TDEE
      const tdee = user.calculateTDEE();
      user.profile.tdee = tdee;

      // Set notification times
      if (data.notificationTimes) {
        user.notifications.times = data.notificationTimes;
      }

      user.onboardingComplete = true;
      user.onboardingMessages = history;
      await user.save();

      // Initialize today's balance
      const localDate = getLocalDate(data.timezone);
      const DailyBalance = require('../models/DailyBalance');
      await DailyBalance.findOneAndUpdate(
        { userId: user._id, localDate },
        {
          $setOnInsert: {
            userId: user._id,
            localDate,
            openingBalance: tdee,
            carryover: 0,
            caloriesConsumed: 0,
            caloriesBurnt: 0,
            currentBalance: tdee
          }
        },
        { upsert: true }
      );

      return res.json({
        message: `Amazing! I've set your daily calorie goal to ${tdee} kcal — that's your $${tdee} daily budget in Athlon. Taking you to your dashboard now! 🚀`,
        complete: true,
        tdee,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          onboardingComplete: user.onboardingComplete,
          theme: user.theme,
          profile: user.profile
        }
      });
    }

    // Add assistant response to history
    history.push({ role: 'assistant', content: response });

    // Update user's onboarding messages
    await User.findByIdAndUpdate(user._id, {
      $set: { onboardingMessages: history }
    });

    res.json({
      message: response,
      complete: false
    });
  } catch (err) {
    console.error('[ONBOARDING] Chat error:', err.message);
    res.status(500).json({ error: 'Failed to process message. Please try again.' });
  }
});

// ── GET /api/onboarding/status ──────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => {
  res.json({
    complete: req.user.onboardingComplete,
    messagesCount: req.user.onboardingMessages?.length || 0
  });
});

module.exports = router;
