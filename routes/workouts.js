const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const WorkoutLog = require('../models/WorkoutLog');
const { analyzeImage, agentChat, parseAIJson } = require('../utils/groq');
const { addWorkoutCalories, getLocalDate } = require('../utils/balance');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

const WORKOUT_VERIFY_SYSTEM = `You are a fitness verification expert. Analyze the provided image and determine if the person is genuinely working out/exercising.

Respond with ONLY a JSON object:
{
  "isWorkedOut": true or false,
  "confidence": "high" or "medium" or "low",
  "description": "Brief description of what you see",
  "reason": "Why you made this determination"
}

Be strict but fair. Signs of working out: gym equipment, workout clothes with visible effort/sweat, running/outdoor exercise, yoga poses, sports activities. 
Be skeptical of: sitting on a couch "claiming" to exercise, just standing near gym equipment, clearly staged photos.`;

const CALORIES_BURNED_SYSTEM = `You are a fitness calorie calculation expert. Given a workout description, estimate calories burned.

Factors to consider:
- Activity type and intensity
- Duration (minutes)
- Standard METs (metabolic equivalents) for the activity

Respond with ONLY a JSON object:
{
  "rawEstimate": 450,
  "adjustedEstimate": 405,
  "reasoning": "Brief explanation of calculation",
  "intensity": "moderate",
  "met": 7.0
}

Note: adjustedEstimate = rawEstimate * 0.9 (10% conservative reduction is automatically applied).
Use a standard 75kg body weight for calculations unless user weight is provided.`;

// ── POST /api/workouts/verify-image ────────────────────────────────────────
router.post('/verify-image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    const verdict = await analyzeImage(
      base64Image,
      mimeType,
      'Is this person working out or exercising? Analyze carefully.',
      req.user?.email
    );

    // Parse AI verdict using JSON system prompt
    let parsed = parseAIJson(verdict);
    if (!parsed) {
      // Fallback: use agent to re-parse
      const reparse = await agentChat(
        [{ role: 'user', content: `The image analysis says: "${verdict}". Extract JSON verdict.` }],
        WORKOUT_VERIFY_SYSTEM,
        256,
        req.user?.email
      );
      parsed = parseAIJson(reparse);
      if (!parsed) {
        console.error('[WORKOUTS] AI failed to parse image verdict. Raw response:', reparse);
        parsed = { isWorkedOut: false, confidence: 'low', description: verdict, reason: 'Could not verify' };
      }
    }

    res.json({
      verified: parsed.isWorkedOut,
      confidence: parsed.confidence,
      description: parsed.description,
      reason: parsed.reason,
      imageBase64: `data:${mimeType};base64,${base64Image}`
    });
  } catch (err) {
    console.error('[WORKOUTS] Verify image error:', err.message);
    res.status(500).json({ error: 'Failed to verify workout image.' });
  }
});

// ── POST /api/workouts/estimate-calories ───────────────────────────────────
router.post('/estimate-calories', requireAuth, async (req, res) => {
  try {
    const { activityType, duration, intensity, description } = req.body;
    const user = req.user;

    if (!activityType || !duration) {
      return res.status(400).json({ error: 'Activity type and duration are required' });
    }

    const userWeight = user.profile?.weight || 75;
    const prompt = `User weight: ${userWeight}kg
Activity: ${activityType}
Duration: ${duration} minutes
Intensity: ${intensity || 'moderate'}
Description: ${description || activityType}

Calculate calories burned.`;

    const response = await agentChat(
      [{ role: 'user', content: prompt }],
      CALORIES_BURNED_SYSTEM,
      256,
      req.user?.email
    );

    const estimate = parseAIJson(response);
    if (!estimate) {
      console.error('[WORKOUTS] AI failed to estimate calories. Raw response:', response);
      return res.status(500).json({ error: 'Failed to estimate calories burned.' });
    }

    // Ensure 10% reduction is applied
    const rawEstimate = estimate.rawEstimate || 300;
    const adjustedEstimate = Math.round(rawEstimate * 0.9);

    res.json({
      rawEstimate,
      adjustedEstimate,
      reasoning: estimate.reasoning,
      intensity: estimate.intensity || intensity || 'moderate',
      met: estimate.met
    });
  } catch (err) {
    console.error('[WORKOUTS] Estimate error:', err.message);
    res.status(500).json({ error: 'Failed to estimate calories burned.' });
  }
});

// ── POST /api/workouts/log ──────────────────────────────────────────────────
router.post('/log', requireAuth, async (req, res) => {
  try {
    const {
      activityType, duration, intensity, description,
      imageVerified, aiImageVerdict, imageBase64,
      rawCaloriesBurnt, caloriesBurnt
    } = req.body;
    const user = req.user;

    if (!activityType || !duration || caloriesBurnt === undefined) {
      return res.status(400).json({ error: 'Activity type, duration, and calories burned are required' });
    }

    const localDate = getLocalDate(user.profile?.timezone);

    const workout = new WorkoutLog({
      userId: user._id,
      activityType,
      duration: Number(duration),
      intensity: intensity || 'moderate',
      description,
      imageVerified: imageVerified || false,
      aiImageVerdict,
      imageBase64,
      rawCaloriesBurnt: rawCaloriesBurnt || Math.round(Number(caloriesBurnt) / 0.9),
      caloriesBurnt: Number(caloriesBurnt),
      finalCaloriesBurnt: Number(caloriesBurnt),
      localDate
    });

    await workout.save();

    // Add to balance
    const balance = await addWorkoutCalories(user._id, localDate, Number(caloriesBurnt));

    res.status(201).json({
      message: 'Workout logged! Calories earned added to your balance.',
      workout: {
        id: workout._id,
        activityType: workout.activityType,
        duration: workout.duration,
        caloriesBurnt: workout.caloriesBurnt,
        loggedAt: workout.loggedAt
      },
      balance: {
        currentBalance: balance.currentBalance,
        caloriesBurnt: balance.caloriesBurnt
      }
    });
  } catch (err) {
    console.error('[WORKOUTS] Log error:', err.message);
    res.status(500).json({ error: 'Failed to log workout.' });
  }
});

// ── GET /api/workouts/today ─────────────────────────────────────────────────
router.get('/today', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const localDate = getLocalDate(user.profile?.timezone);

    const workouts = await WorkoutLog.find({
      userId: user._id,
      localDate
    }).sort({ loggedAt: -1 });

    res.json({ workouts, localDate });
  } catch (err) {
    console.error('[WORKOUTS] Today error:', err.message);
    res.status(500).json({ error: 'Failed to fetch today\'s workouts.' });
  }
});

// ── GET /api/workouts/history ───────────────────────────────────────────────
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const workouts = await WorkoutLog.find({ userId: req.user._id })
      .sort({ loggedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ workouts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch workout history.' });
  }
});

module.exports = router;
