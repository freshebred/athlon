const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const MealLog = require('../models/MealLog');
const { analyzeImage, reasoningChat, agentChat, parseAIJson } = require('../utils/groq');
const { searchIngredient, calcCalories } = require('../utils/usda');
const { deductMealCalories, reverseDeduction, getLocalDate, getTodayBalance } = require('../utils/balance');

// Multer config for image uploads (memory storage, max 5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ── System prompts ──────────────────────────────────────────────────────────

const INGREDIENT_SYSTEM = `You are a culinary nutrition expert. When given a meal name, list ALL possible ingredients that could realistically be in that meal. Include:
- Primary proteins, carbohydrates, vegetables
- Oils, fats, condiments, sauces
- Common garnishes and seasonings
- Standard preparation ingredients (flour for breading, butter for cooking, etc.)

For each ingredient, also provide:
- Whether it is commonly present (true/false for "isCommon" — use true for typical/expected ingredients)
- A typical amount in grams for a single serving
- The category: protein, carbohydrate, fat, vegetable, condiment, seasoning, dairy, other

Respond ONLY with a valid JSON array. No text before or after.

Example format:
[
  { "name": "chicken breast", "amountGrams": 150, "isCommon": true, "category": "protein" },
  { "name": "olive oil", "amountGrams": 15, "isCommon": true, "category": "fat" },
  { "name": "garlic", "amountGrams": 5, "isCommon": true, "category": "seasoning" }
]

Always include at least 8-12 ingredients. Be thorough but realistic.`;

const VERIFY_SYSTEM = `You are a calorie verification expert. You will be given:
1. A meal name
2. A list of ingredients with their calories
3. The total calculated calories

Your job is to assess whether the total calorie estimate is reasonable for this meal.

Respond with a JSON object:
{
  "reasonable": true or false,
  "verdict": "Brief explanation (1-2 sentences)",
  "suggestedRange": { "min": 300, "max": 600 },
  "confidence": "high" or "medium" or "low"
}`;

const USDA_RETRY_SYSTEM = `You are a food database search expert. Given an ingredient name that returned poor or no results from the USDA FoodData Central database, suggest better search terms.

Respond with a JSON object:
{
  "retryQuery": "better search term",
  "useEstimate": false,
  "estimatedCaloriesPer100g": null,
  "reason": "why you changed the search term"
}

If the ingredient is very generic or unmatchable (like 'seasoning mix'), set useEstimate to true and provide an estimated caloriesPer100g value.`;

// ── POST /api/meals/analyze-name ────────────────────────────────────────────
// Step 1: User enters meal name → AI returns ingredient list
router.post('/analyze-name', requireAuth, async (req, res) => {
  try {
    const { mealName } = req.body;
    if (!mealName?.trim()) {
      return res.status(400).json({ error: 'Meal name is required' });
    }

    const prompt = `List all possible ingredients for: "${mealName.trim()}"`;
    const response = await reasoningChat(
      [{ role: 'user', content: prompt }],
      INGREDIENT_SYSTEM
    );

    const ingredients = parseAIJson(response);
    if (!Array.isArray(ingredients)) {
      return res.status(500).json({ error: 'Failed to analyze meal. Please try again.' });
    }

    res.json({
      mealName: mealName.trim(),
      ingredients: ingredients.map(ing => ({
        name: ing.name,
        amountGrams: ing.amountGrams || 100,
        isCommon: ing.isCommon !== false,
        category: ing.category || 'other',
        selected: ing.isCommon !== false  // pre-select common ingredients
      }))
    });
  } catch (err) {
    console.error('[MEALS] Analyze name error:', err.message);
    res.status(500).json({ error: 'Failed to analyze meal ingredients.' });
  }
});

// ── POST /api/meals/analyze-image ───────────────────────────────────────────
// Step 1b: User uploads food image → vision model describes it → reasoning gets ingredients
router.post('/analyze-image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Step 1: Vision model describes the food
    const visionPrompt = `Describe this food image in detail. Include:
- What the dish/meal appears to be
- What ingredients are visible
- Approximate portion size
- Cooking method if apparent
Be specific and thorough for nutritional analysis purposes.`;

    const description = await analyzeImage(base64Image, mimeType, visionPrompt);

    // Step 2: Reasoning model assesses ingredients from description
    const ingredientPrompt = `Based on this food description: "${description}"
    
List ALL possible ingredients in this meal.`;

    const ingredientResponse = await reasoningChat(
      [{ role: 'user', content: ingredientPrompt }],
      INGREDIENT_SYSTEM
    );

    const ingredients = parseAIJson(ingredientResponse);
    if (!Array.isArray(ingredients)) {
      return res.status(500).json({ error: 'Failed to analyze image ingredients. Please try again.' });
    }

    // Extract meal name from description
    const nameMatch = description.match(/(?:appears? to be|looks like|is a?n?) ([A-Za-z\s]+?)(?:\.|,|with|$)/i);
    const mealName = nameMatch ? nameMatch[1].trim() : 'Uploaded meal';

    res.json({
      mealName,
      description,
      imageBase64: `data:${mimeType};base64,${base64Image}`,
      ingredients: ingredients.map(ing => ({
        name: ing.name,
        amountGrams: ing.amountGrams || 100,
        isCommon: ing.isCommon !== false,
        category: ing.category || 'other',
        selected: ing.isCommon !== false
      }))
    });
  } catch (err) {
    console.error('[MEALS] Analyze image error:', err.message);
    res.status(500).json({ error: 'Failed to analyze image. Please try again.' });
  }
});

// ── POST /api/meals/usda-lookup ─────────────────────────────────────────────
// Step 2: Look up selected ingredients in USDA API
router.post('/usda-lookup', requireAuth, async (req, res) => {
  try {
    const { ingredients } = req.body;
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'Ingredients array is required' });
    }

    const results = await Promise.all(
      ingredients.map(async (ing) => {
        return await lookupIngredientWithRetry(ing);
      })
    );

    res.json({ ingredients: results });
  } catch (err) {
    console.error('[MEALS] USDA lookup error:', err.message);
    res.status(500).json({ error: 'Failed to look up nutritional data.' });
  }
});

/**
 * Look up an ingredient with automatic AI-powered retry on poor results
 */
async function lookupIngredientWithRetry(ing) {
  const { name, amountGrams } = ing;
  let query = name;

  // First attempt
  let results = await searchIngredient(query, 3);
  let bestMatch = results[0];

  // Check if result is suspicious (0 or very low calories for non-zero food)
  const shouldRetry = !bestMatch || 
    bestMatch.caloriesPer100g === 0 || 
    (bestMatch.caloriesPer100g < 5 && !isLowCalorieFood(name));

  if (shouldRetry) {
    // Ask AI for a better search term
    try {
      const retryResponse = await agentChat(
        [{ role: 'user', content: `Ingredient: "${name}", USDA search returned ${bestMatch ? `${bestMatch.caloriesPer100g} cal/100g` : 'no results'}. Better search term?` }],
        USDA_RETRY_SYSTEM,
        256
      );
      const retryData = parseAIJson(retryResponse);

      if (retryData?.useEstimate) {
        // Use AI estimate
        const calories = calcCalories(retryData.estimatedCaloriesPer100g || 50, amountGrams);
        return {
          name,
          amountGrams,
          calories,
          protein: 0,
          carbs: 0,
          fat: 0,
          usdaDescription: `AI estimate (${retryData.reason})`,
          verified: false,
          retried: true
        };
      } else if (retryData?.retryQuery) {
        // Retry with better query
        results = await searchIngredient(retryData.retryQuery, 3);
        bestMatch = results[0];
      }
    } catch (retryErr) {
      console.error('[MEALS] Retry error for', name, ':', retryErr.message);
    }
  }

  if (!bestMatch) {
    // Fallback: use basic estimate
    return {
      name,
      amountGrams,
      calories: Math.round(amountGrams * 0.5), // ~50 kcal/100g generic estimate
      protein: 0,
      carbs: 0,
      fat: 0,
      usdaDescription: 'Estimated (not found in database)',
      verified: false
    };
  }

  const calories = calcCalories(bestMatch.caloriesPer100g, amountGrams);
  const protein = Math.round((bestMatch.proteinPer100g * amountGrams) / 100 * 10) / 10;
  const carbs = Math.round((bestMatch.carbsPer100g * amountGrams) / 100 * 10) / 10;
  const fat = Math.round((bestMatch.fatPer100g * amountGrams) / 100 * 10) / 10;

  return {
    name,
    amountGrams,
    calories,
    protein,
    carbs,
    fat,
    usdaId: String(bestMatch.fdcId),
    usdaDescription: bestMatch.description,
    verified: true
  };
}

function isLowCalorieFood(name) {
  const lowCalFoods = ['water', 'celery', 'lettuce', 'cucumber', 'spinach', 'broth', 'stock'];
  return lowCalFoods.some(f => name.toLowerCase().includes(f));
}

// ── POST /api/meals/verify ──────────────────────────────────────────────────
// Step 3: AI verifies if final calorie total seems reasonable
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { mealName, ingredients, totalCalories } = req.body;

    const verifyPrompt = `Meal: "${mealName}"
Total calories calculated: ${totalCalories} kcal
Ingredients breakdown:
${ingredients.map(i => `- ${i.name}: ${i.amountGrams}g = ${i.calories} kcal`).join('\n')}

Is this calorie total reasonable?`;

    const response = await agentChat(
      [{ role: 'user', content: verifyPrompt }],
      VERIFY_SYSTEM,
      256
    );

    const verdict = parseAIJson(response);
    if (!verdict) {
      return res.json({ reasonable: true, verdict: 'Unable to verify — proceeding with calculated values.', confidence: 'low' });
    }

    res.json(verdict);
  } catch (err) {
    console.error('[MEALS] Verify error:', err.message);
    res.json({ reasonable: true, verdict: 'Verification skipped due to an error.', confidence: 'low' });
  }
});

// ── POST /api/meals/log ─────────────────────────────────────────────────────
// Step 4: Save the confirmed meal to the database
router.post('/log', requireAuth, async (req, res) => {
  try {
    const { name, logType, ingredients, imageBase64, aiVerdict } = req.body;
    const user = req.user;

    if (!name || !ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ error: 'Meal name and ingredients are required' });
    }

    const localDate = getLocalDate(user.profile?.timezone);

    // Calculate totals
    const totalCalories = ingredients.reduce((sum, i) => sum + (i.calories || 0), 0);
    const totalProtein  = ingredients.reduce((sum, i) => sum + (i.protein  || 0), 0);
    const totalCarbs    = ingredients.reduce((sum, i) => sum + (i.carbs    || 0), 0);
    const totalFat      = ingredients.reduce((sum, i) => sum + (i.fat      || 0), 0);

    // Normalize ingredient fields: frontend uses amountGrams, schema requires amount
    const normalizedIngredients = ingredients.map(i => ({
      name:            i.name,
      amount:          i.amount ?? i.amountGrams ?? 100,  // schema field
      unit:            i.unit || 'g',
      calories:        Math.round(i.calories  || 0),
      protein:         Math.round((i.protein  || 0) * 10) / 10,
      carbs:           Math.round((i.carbs    || 0) * 10) / 10,
      fat:             Math.round((i.fat      || 0) * 10) / 10,
      usdaId:          i.usdaId          || undefined,
      usdaDescription: i.usdaDescription || undefined,
      verified:        i.verified        ?? false
    }));

    const meal = new MealLog({
      userId: user._id,
      name,
      logType: logType || 'ai_name',
      imageUrl: imageBase64 || null,
      ingredients: normalizedIngredients,
      totalCalories,
      totalProtein: Math.round(totalProtein * 10) / 10,
      totalCarbs: Math.round(totalCarbs * 10) / 10,
      totalFat: Math.round(totalFat * 10) / 10,
      aiVerdict: aiVerdict?.verdict || null,
      localDate
    });

    await meal.save();

    // Deduct from balance
    const balance = await deductMealCalories(user._id, localDate, totalCalories);

    res.status(201).json({
      message: 'Meal logged successfully',
      meal: {
        id: meal._id,
        name: meal.name,
        totalCalories: meal.totalCalories,
        totalProtein: meal.totalProtein,
        totalCarbs: meal.totalCarbs,
        totalFat: meal.totalFat,
        loggedAt: meal.loggedAt
      },
      balance: {
        currentBalance: balance.currentBalance,
        caloriesConsumed: balance.caloriesConsumed
      }
    });
  } catch (err) {
    console.error('[MEALS] Log error:', err.message);
    res.status(500).json({ error: 'Failed to log meal.' });
  }
});

// ── POST /api/meals/manual ──────────────────────────────────────────────────
// Manual calorie entry
router.post('/manual', requireAuth, async (req, res) => {
  try {
    const { name, calories, protein, carbs, fat } = req.body;
    const user = req.user;

    if (!name || !calories || isNaN(calories)) {
      return res.status(400).json({ error: 'Meal name and calories are required' });
    }

    const localDate = getLocalDate(user.profile?.timezone);

    const meal = new MealLog({
      userId: user._id,
      name,
      logType: 'manual',
      ingredients: [{
        name,
        amount: 1,
        unit: 'serving',
        calories: Number(calories),
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
        verified: false
      }],
      totalCalories: Number(calories),
      totalProtein: Number(protein) || 0,
      totalCarbs: Number(carbs) || 0,
      totalFat: Number(fat) || 0,
      aiVerdict: 'Manual entry',
      localDate
    });

    await meal.save();
    const balance = await deductMealCalories(user._id, localDate, Number(calories));

    res.status(201).json({
      message: 'Meal logged manually',
      meal: { id: meal._id, name, totalCalories: Number(calories), loggedAt: meal.loggedAt },
      balance: { currentBalance: balance.currentBalance }
    });
  } catch (err) {
    console.error('[MEALS] Manual log error:', err.message);
    res.status(500).json({ error: 'Failed to log meal.' });
  }
});

// ── GET /api/meals/today ────────────────────────────────────────────────────
router.get('/today', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const localDate = getLocalDate(user.profile?.timezone);

    const meals = await MealLog.find({
      userId: user._id,
      localDate,
      isDeleted: false
    }).sort({ loggedAt: -1 });

    res.json({ meals, localDate });
  } catch (err) {
    console.error('[MEALS] Today error:', err.message);
    res.status(500).json({ error: 'Failed to fetch today\'s meals.' });
  }
});

// ── GET /api/meals/history ──────────────────────────────────────────────────
router.get('/history', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { page = 1, limit = 30 } = req.query;

    const meals = await MealLog.find({
      userId: user._id,
      isDeleted: false
    })
      .sort({ loggedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Group by localDate
    const grouped = {};
    meals.forEach(meal => {
      if (!grouped[meal.localDate]) grouped[meal.localDate] = [];
      grouped[meal.localDate].push(meal);
    });

    res.json({ grouped, meals });
  } catch (err) {
    console.error('[MEALS] History error:', err.message);
    res.status(500).json({ error: 'Failed to fetch meal history.' });
  }
});

// ── PUT /api/meals/:id ──────────────────────────────────────────────────────
// Edit a meal — PT Coach must approve (handled via ptCoach route)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { newCalories, reason, ptApproved, ptNote } = req.body;
    const meal = await MealLog.findOne({ _id: req.params.id, userId: req.user._id });

    if (!meal) return res.status(404).json({ error: 'Meal not found' });
    if (!ptApproved) {
      return res.status(403).json({ error: 'PT Coach approval required to edit meals', requiresPT: true });
    }

    const oldCalories = meal.totalCalories;
    const diff = newCalories - oldCalories;

    // Record edit history
    meal.editHistory.push({
      editedAt: new Date(),
      previousCalories: oldCalories,
      reason: reason || 'User requested edit',
      ptApproved: true,
      ptNote: ptNote || ''
    });

    meal.totalCalories = newCalories;
    // Update ingredient calories in-place using Mongoose's safe set method
    if (meal.ingredients.length > 0) {
      meal.ingredients[0].set('calories', newCalories);
    }
    await meal.save();

    // Adjust balance
    const localDate = getLocalDate(req.user.profile?.timezone);
    if (diff > 0) {
      await deductMealCalories(req.user._id, localDate, diff);
    } else {
      await reverseDeduction(req.user._id, localDate, Math.abs(diff));
    }

    res.json({ message: 'Meal updated successfully', meal });
  } catch (err) {
    console.error('[MEALS] Edit error:', err.message);
    res.status(500).json({ error: 'Failed to update meal.' });
  }
});

// ── DELETE /api/meals/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { reason, ptApproved, ptNote } = req.body;
    const meal = await MealLog.findOne({ _id: req.params.id, userId: req.user._id });

    if (!meal) return res.status(404).json({ error: 'Meal not found' });
    if (!ptApproved) {
      return res.status(403).json({
        error: 'PT Coach approval required to delete meals',
        requiresPT: true,
        mealId: req.params.id
      });
    }

    // Soft delete
    meal.isDeleted = true;
    meal.deletedAt = new Date();
    meal.deleteReason = reason || 'User requested deletion';
    meal.ptDeleteApproved = true;
    await meal.save();

    // Restore balance
    const localDate = getLocalDate(req.user.profile?.timezone);
    await reverseDeduction(req.user._id, localDate, meal.totalCalories);

    res.json({ message: 'Meal deleted successfully', restoredCalories: meal.totalCalories });
  } catch (err) {
    console.error('[MEALS] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete meal.' });
  }
});

module.exports = router;
