const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const { requireAuth } = require('../middleware/auth');
const WorkoutLog = require('../models/WorkoutLog');
const { analyzeImageUrl, agentChat, parseAIJson } = require('../utils/groq');
const { addWorkoutCalories, getLocalDate } = require('../utils/balance');

// ── Temp upload directory (served as static by Express) ────────────────────
const TEMP_DIR = path.join(__dirname, '../public/temp-uploads');

// Ensure the temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// On startup: purge any stale files older than 10 minutes left from a previous run
(function cleanStaleTempFiles() {
  try {
    const TEN_MIN = 10 * 60 * 1000;
    const now = Date.now();
    fs.readdirSync(TEMP_DIR).forEach(file => {
      const filePath = path.join(TEMP_DIR, file);
      try {
        const { mtimeMs } = fs.statSync(filePath);
        if (now - mtimeMs > TEN_MIN) {
          fs.unlinkSync(filePath);
          console.log('[WORKOUTS] Purged stale temp file:', file);
        }
      } catch { /* ignore stat/unlink errors */ }
    });
  } catch { /* ignore read errors */ }
})();

// ── Multer: memory storage, 20 MB limit ────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ── System Prompts ──────────────────────────────────────────────────────────

const WORKOUT_VERIFY_SYSTEM = `You are a fitness activity verification assistant. Your job is to confirm that the photo is plausibly consistent with the stated workout — not to catch cheaters. Give the user the benefit of the doubt.

Activity-specific guidelines (apply the one that matches the claimed activity):
- **Gym / Weight training / Strength**: Accept if the photo shows a gym environment (equipment, weight racks, gym floor, locker room, etc.). The user doesn't need to be mid-rep.
- **Swimming**: Accept if there is a swimming pool visible in the image (indoor or outdoor, public or private).
- **Walking / Running / Jogging / Hiking**: Accept if the photo shows an outdoor environment (sidewalk, park, trail, road, nature) OR if the user is wearing running/athletic shoes outside. A landscape or street photo with no visible person is fine.
- **Cycling / Biking**: Accept if there is a bike visible, or an outdoor/road environment consistent with cycling.
- **Sports / Other cardio**: Accept any image that plausibly relates to outdoor activity or a sports venue.
- **General**: When in doubt, approve. Only reject photos that are clearly irrelevant (e.g., a photo of food, a selfie indoors on a couch with no workout context whatsoever).

Respond with ONLY a JSON object:
{
  "isWorkedOut": true or false,
  "confidence": "high" or "medium" or "low",
  "description": "Brief description of what you see in the image",
  "reason": "Why you approved or rejected this image"
}`;

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

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Save the image buffer to a temp file and return:
 *  - tempFilePath: absolute path on disk
 *  - publicUrl:    publicly accessible URL for Groq to fetch
 *
 * The caller is responsible for deleting the file after use.
 * A safety setTimeout also deletes it after 5 minutes.
 */
function saveTempImage(buffer, mimeType) {
  const ext      = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const filename = `workout-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(TEMP_DIR, filename);

  fs.writeFileSync(filePath, buffer);

  // Safety net: delete after 5 minutes in case the request crashes
  const timer = setTimeout(() => {
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  }, 5 * 60 * 1000);

  // Allow the process to exit without waiting for this timer
  if (timer.unref) timer.unref();

  const serverUrl = (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
  const publicUrl = `${serverUrl}/temp-uploads/${filename}`;

  return { filePath, publicUrl };
}

/**
 * Delete a temp file immediately, swallowing any errors.
 */
function deleteTempFile(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* already deleted or never existed */ }
}

// ── POST /api/workouts/verify-image ────────────────────────────────────────
router.post('/verify-image', requireAuth, upload.single('image'), async (req, res) => {
  let tempFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const { buffer, mimetype } = req.file;

    // ── 1. Save to temp dir and get a public URL for Groq ────────────────
    const { filePath, publicUrl } = saveTempImage(buffer, mimetype);
    tempFilePath = filePath;
    console.log('[WORKOUTS] Temp image saved:', publicUrl);

    // ── 2. Analyze with Groq vision model via public URL (supports 20 MB) ─
    const { activityType } = req.body;
    const activityContext = activityType
      ? `The user logged a "${activityType}" workout. `
      : '';
    const activityHint = activityType
      ? (() => {
          const a = activityType.toLowerCase();
          if (a.includes('gym') || a.includes('weight') || a.includes('strength') || a.includes('lift'))
            return 'Accept if there is any gym equipment or gym environment visible.';
          if (a.includes('swim'))
            return 'Accept if there is a swimming pool visible anywhere in the image.';
          if (a.includes('walk') || a.includes('run') || a.includes('jog') || a.includes('hike'))
            return 'Accept if the photo shows an outdoor environment (street, park, trail, nature) or running/athletic shoes in an outdoor setting. A scenic outdoor photo with no person is fine.';
          if (a.includes('cycl') || a.includes('bike') || a.includes('bicycl'))
            return 'Accept if there is a bike visible or an outdoor/road environment consistent with cycling.';
          return 'Accept if the image plausibly relates to physical activity or exercise in any way.';
        })()
      : 'Accept if the image plausibly relates to any physical activity or exercise.';
    const promptText = `${activityContext}Does this photo reasonably match the claimed workout? ${activityHint} Only reject if the image is clearly unrelated to any exercise (e.g., a photo of food or an indoor couch selfie with zero workout context). Respond with ONLY a JSON object: { "isWorkedOut": true or false, "confidence": "high" or "medium" or "low", "description": "Brief description of what you see", "reason": "Why you approved or rejected this photo" }`;
    const verdict = await analyzeImageUrl(publicUrl, promptText, req.user?.email);

    // ── 4. Delete temp file immediately — Groq is done fetching it ────────
    deleteTempFile(filePath);
    tempFilePath = null;

    // ── 5. Parse AI verdict ───────────────────────────────────────────────
    let parsed = parseAIJson(verdict);
    if (!parsed) {
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
      verified:     parsed.isWorkedOut,
      confidence:   parsed.confidence,
      description:  parsed.description,
      reason:       parsed.reason,
      imageBase64: `data:${mimetype};base64,${buffer.toString('base64')}`
    });
  } catch (err) {
    // Ensure cleanup even on crash
    if (tempFilePath) deleteTempFile(tempFilePath);
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
    const rawEstimate      = estimate.rawEstimate || 300;
    const adjustedEstimate = Math.round(rawEstimate * 0.9);

    res.json({
      rawEstimate,
      adjustedEstimate,
      reasoning: estimate.reasoning,
      intensity: estimate.intensity || intensity || 'moderate',
      met:       estimate.met
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
      userId:           user._id,
      activityType,
      duration:         Number(duration),
      intensity:        intensity || 'moderate',
      description,
      imageVerified:    imageVerified || false,
      aiImageVerdict,
      imageBase64,
      rawCaloriesBurnt: rawCaloriesBurnt || Math.round(Number(caloriesBurnt) / 0.9),
      caloriesBurnt:    Number(caloriesBurnt),
      finalCaloriesBurnt: Number(caloriesBurnt),
      localDate
    });

    await workout.save();

    // Add to balance
    const balance = await addWorkoutCalories(user._id, localDate, Number(caloriesBurnt));

    res.status(201).json({
      message: 'Workout logged! Calories earned added to your balance.',
      workout: {
        id:           workout._id,
        activityType: workout.activityType,
        duration:     workout.duration,
        caloriesBurnt: workout.caloriesBurnt,
        loggedAt:     workout.loggedAt
      },
      balance: {
        currentBalance: balance.currentBalance,
        caloriesBurnt:  balance.caloriesBurnt
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
    const user      = req.user;
    const localDate = getLocalDate(user.profile?.timezone);

    const workouts = await WorkoutLog.find({
      userId: user._id,
      localDate
    }).sort({ loggedAt: -1 });

    res.json({ workouts, localDate });
  } catch (err) {
    console.error('[WORKOUTS] Today error:', err.message);
    res.status(500).json({ error: "Failed to fetch today's workouts." });
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
