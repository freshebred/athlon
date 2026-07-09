const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const MealLog = require('../models/MealLog');
const { analyzeImage, reasoningChat, agentChat, parseAIJson, checkUserInput } = require('../utils/groq');
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

// ── Measurement System ───────────────────────────────────────────────────────

/**
 * Measurement unit categories with sensible defaults and ranges.
 * The AI model should use this to assign the right unit per ingredient.
 */
const UNIT_PROFILES = {
  // Countable items
  piece:  { singular: 'piece', plural: 'pieces', type: 'count', step: 1, min: 0.5, max: 20,   defaultAmt: 1   },
  egg:    { singular: 'egg',   plural: 'eggs',   type: 'count', step: 1, min: 1,   max: 12,   defaultAmt: 2   },
  slice:  { singular: 'slice', plural: 'slices', type: 'count', step: 1, min: 1,   max: 20,   defaultAmt: 2   },
  strip:  { singular: 'strip', plural: 'strips', type: 'count', step: 1, min: 1,   max: 10,   defaultAmt: 3   },
  clove:  { singular: 'clove', plural: 'cloves', type: 'count', step: 1, min: 1,   max: 10,   defaultAmt: 2   },
  // Volume (liquids)
  ml:     { singular: 'ml',    plural: 'ml',     type: 'volume',step: 10, min: 5,  max: 1000, defaultAmt: 100 },
  cup:    { singular: 'cup',   plural: 'cups',   type: 'volume',step: 0.25,min: 0.25,max: 4,  defaultAmt: 1   },
  tbsp:   { singular: 'tbsp',  plural: 'tbsp',   type: 'volume',step: 0.5, min: 0.5, max: 10, defaultAmt: 1   },
  tsp:    { singular: 'tsp',   plural: 'tsp',    type: 'volume',step: 0.25,min: 0.25,max: 5,  defaultAmt: 1   },
  // Weight
  g:      { singular: 'g',     plural: 'g',      type: 'weight',step: 5,   min: 1,  max: 1000, defaultAmt: 100 },
  oz:     { singular: 'oz',    plural: 'oz',      type: 'weight',step: 0.5, min: 0.5,max: 32,   defaultAmt: 3.5 },
  // Pinch / small amounts (for seasonings like salt, pepper, spices)
  pinch:  { singular: 'pinch', plural: 'pinches', type: 'count', step: 1,  min: 1,  max: 5,    defaultAmt: 1   }
};

/**
 * Map ingredient name keywords → best measurement unit.
 * Ordered from most-specific to least-specific.
 */
const UNIT_RULES = [
  // Eggs and egg-like
  { keywords: ['egg', 'yolk', 'white'],                                unit: 'egg'  },
  // Bread / deli items sold in slices
  { keywords: ['bread', 'toast', 'slice', 'prosciutto', 'ham', 'cheese slice', 'deli'],
    unit: 'slice' },
  { keywords: ['bacon', 'strip'],                                        unit: 'strip' },
  // Garlic
  { keywords: ['garlic'],                                                unit: 'clove' },
  // Seasoning / spices — use tsp/pinch
  { keywords: ['salt', 'pepper', 'cumin', 'paprika', 'oregano', 'thyme',
               'cinnamon', 'turmeric', 'chili flake', 'spice', 'seasoning'],
    unit: 'tsp' },
  // Very tiny pinch-level items
  { keywords: ['pinch', 'nutmeg', 'cayenne'],                           unit: 'pinch' },
  // Oils / sauces  — tablespoon
  { keywords: ['oil', 'sauce', 'dressing', 'mayo', 'ketchup', 'vinegar',
               'soy sauce', 'hot sauce', 'butter', 'margarine', 'cream', 'tahini'],
    unit: 'tbsp' },
  // Liquids measured in cups
  { keywords: ['milk', 'juice', 'broth', 'stock', 'water', 'yogurt', 'cream', 'coconut milk'],
    unit: 'ml' },
  // Everything else → grams
];

/**
 * Determine the best measurement unit for an ingredient by name.
 */
function getBestUnit(ingredientName) {
  const lower = (ingredientName || '').toLowerCase();
  for (const rule of UNIT_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) {
      return rule.unit;
    }
  }
  return 'g';
}

/**
 * Convert ingredient amount to grams for USDA lookup.
 * Uses rough approximations for non-gram units.
 */
function toGrams(amount, unit, ingredientName) {
  const name = (ingredientName || '').toLowerCase();
  switch (unit) {
    case 'egg':   return amount * 50;    // ~50g per large egg
    case 'slice': {
      // Approximate slice weight varies by food type
      if (name.includes('bread') || name.includes('toast')) return amount * 30;
      if (name.includes('cheese')) return amount * 22;
      if (name.includes('ham') || name.includes('prosciutto')) return amount * 20;
      return amount * 25;
    }
    case 'strip':  return amount * 15;   // bacon strip ~15g
    case 'clove':  return amount * 5;    // garlic clove ~5g
    case 'cup':    return amount * 240;  // 1 cup ≈ 240ml → ~240g for liquids
    case 'ml':     return amount;        // 1ml water ≈ 1g (rough)
    case 'tbsp':   return amount * 15;   // 1 tbsp ≈ 15g
    case 'tsp':    return amount * 5;    // 1 tsp ≈ 5g
    case 'pinch':  return amount * 0.5;  // a pinch ≈ 0.5g
    case 'oz':     return amount * 28.35;
    case 'g':
    default:       return amount;
  }
}

// ── System Prompts ───────────────────────────────────────────────────────────

const INGREDIENT_SYSTEM = `You are a culinary nutrition expert. When given a meal name or description, list ALL possible ingredients that could realistically be in that meal.

For each ingredient you MUST choose the most appropriate measurement unit from this list:
- "g"     → weight in grams (proteins like chicken, beef, fish, rice, pasta, vegetables measured by weight)
- "egg"   → whole eggs (e.g. 2 eggs)
- "slice" → slices of bread, cheese, deli meat
- "strip" → strips of bacon
- "clove" → garlic cloves
- "ml"    → liquid volume: milk, juice, broth, water, cream, yogurt
- "tbsp"  → tablespoons: oil, butter, sauce, mayo, dressing, vinegar, paste
- "tsp"   → teaspoons: salt, pepper, cumin, spices, small seasonings
- "pinch" → very small seasoning amounts: nutmeg, cayenne, chili flakes
- "cup"   → cups (use for oats, flour, loose cereals)
- "oz"    → ounces (use when the ingredient is typically measured in oz)
- "piece" → whole pieces that don't fit other units

Rules:
1. NEVER measure eggs in grams — use "egg" unit.
2. NEVER measure salt, pepper, or typical seasonings above 2 tsp — use "tsp" or "pinch".
3. NEVER measure liquids (milk, juice, oil) in grams — use "ml", "cup", or "tbsp".
4. Always choose amounts that reflect real cooking quantities.

For each ingredient, provide:
- "name": ingredient name (string)
- "amount": numeric amount in the chosen unit (number, can be decimal like 0.5)
- "unit": the unit string (from the list above)
- "amountGrams": approximate weight in grams (number, for calorie lookup)
- "isCommon": true if typically present in this dish, false if optional/uncommon
- "category": one of: "protein", "carbohydrate", "fat", "vegetable", "dairy", "condiment", "seasoning", "other"

Respond ONLY with a valid JSON array. No text before or after.

Example:
[
  { "name": "eggs", "amount": 2, "unit": "egg", "amountGrams": 100, "isCommon": true, "category": "protein" },
  { "name": "butter", "amount": 1, "unit": "tbsp", "amountGrams": 14, "isCommon": true, "category": "fat" },
  { "name": "salt", "amount": 0.25, "unit": "tsp", "amountGrams": 1.5, "isCommon": true, "category": "seasoning" },
  { "name": "milk", "amount": 50, "unit": "ml", "amountGrams": 50, "isCommon": false, "category": "dairy" },
  { "name": "cheddar cheese", "amount": 1, "unit": "slice", "amountGrams": 22, "isCommon": false, "category": "dairy" }
]

Break the meal down into its core ingredients. Include all realistic components, typically 3-10 ingredients depending on complexity. Be thorough but realistic.`;

const VERIFY_SYSTEM = `You are a calorie verification expert for a fitness tracking app. Your role is to:

1. CHECK the meal name — does it match the ingredient list? Flag suspicious mismatches.
2. CHECK each ingredient's calorie count and amount — is it realistic for a single typical serving?
   - Highlight ALL ingredients whose calories or amounts look too high or too low. You MUST evaluate every ingredient and flag every single one that is incorrect. Do not stop at just one!
   - For EACH flagged ingredient, propose a specific corrected amount OR corrected calories.
3. EVALUATE the total — is it in a plausible range for this type of meal?

IMPORTANT RESPONSE FORMAT — respond ONLY with valid JSON:
{
  "reasonable": true or false,
  "verdict": "Human-readable verdict (1-3 sentences, friendly tone)",
  "confidence": "high" or "medium" or "low",
  "suggestedRange": { "min": number, "max": number },
  "flaggedIngredients": [
    {
      "name": "ingredient name",
      "issue": "brief description of the problem",
      "suggestedAmount": 100,
      "suggestedAmountUnit": "g",
      "suggestedCalories": 165,
      "reason": "why this change makes sense"
    }
  ],
  "mealNameOk": true or false,
  "mealNameNote": "Optional note if meal name seems wrong"
}

"flaggedIngredients" should be an empty array [] if everything looks correct.
Keep the verdict friendly and encouraging — this is a fitness app, not a courtroom.`;

const VERIFY_AFTER_EDIT_SYSTEM = `You are a calorie verification expert reviewing user edits to a meal log in a fitness app.

The user has modified one or more ingredient amounts or calories after the initial AI analysis.
Your job is to:

1. DETERMINE the intent: Is this user being honest? (accidentally entered wrong value, genuinely correcting an error, or possibly manipulating?)
2. VALIDATE the edits: Do the modified values make nutritional sense?
3. RESPOND with one of these verdicts:
   - "approve": Changes look correct — compliment the user and approve logging
   - "question": Changes look suspicious or unusual — ask for clarification politely
   - "suggest_correction": Changes are clearly wrong — propose a better value
   - "flag_manipulation": Strong signs of manipulation (drastically lowering calories unrealistically)

IMPORTANT: Be CHARITABLE. Most users are just being honest and trying to be accurate.
Only flag manipulation if it's very clear (e.g., reducing 800-calorie burger to 50 calories).

Respond ONLY with valid JSON:
{
  "verdict": "approve" | "question" | "suggest_correction" | "flag_manipulation",
  "message": "Friendly message to show the user (1-3 sentences). If approving, be encouraging!",
  "canLog": true or false,
  "suggestedCorrections": [
    {
      "ingredientName": "name",
      "suggestedAmount": number,
      "suggestedAmountUnit": "unit",
      "suggestedCalories": number,
      "reason": "brief reason"
    }
  ]
}

"suggestedCorrections" should be [] if no corrections needed.
"canLog" is true for "approve", false for others unless the issue is minor.`;

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
// Step 1: User enters meal name → AI returns ingredient list with proper units
router.post('/analyze-name', requireAuth, async (req, res) => {
  try {
    const { mealName } = req.body;
    if (!mealName?.trim()) {
      return res.status(400).json({ error: 'Meal name is required' });
    }

    // Safeguard check
    const safeCheck = await checkUserInput(mealName.trim());
    if (!safeCheck.safe) {
      return res.status(400).json({ error: 'Invalid input detected. Please enter a valid meal name.' });
    }

    const prompt = `List all possible ingredients for: "${mealName.trim()}"`;
    const response = await reasoningChat(
      [{ role: 'user', content: prompt }],
      INGREDIENT_SYSTEM
    );

    const ingredients = parseAIJson(response);
    if (!Array.isArray(ingredients)) {
      console.error('[MEALS] AI did not return a valid array. Raw response:', response);
      return res.status(500).json({ error: 'Failed to analyze meal. Please try again.' });
    }

    res.json({
      mealName: mealName.trim(),
      ingredients: normalizeIngredients(ingredients)
    });
  } catch (err) {
    console.error('[MEALS] Analyze name error:', err.message);
    res.status(500).json({ error: 'Failed to analyze meal ingredients.' });
  }
});

// ── POST /api/meals/analyze-image ───────────────────────────────────────────
// Step 1b: User uploads food image → vision model → reasoning gets ingredients
router.post('/analyze-image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Step 1: Vision model describes the food
    const visionPrompt = `Describe this food image in detail. Start your response exactly with "Meal Name: [Name]" where [Name] is a concise, descriptive name of the meal (e.g. "Grilled Chicken Salad", "Pepperoni Pizza", "Scrambled Eggs on Toast"). Then include:
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
      console.error('[MEALS] Image AI did not return a valid array. Raw response:', ingredientResponse);
      return res.status(500).json({ error: 'Failed to analyze image ingredients. Please try again.' });
    }

    // Extract meal name from description
    const nameMatch = description.match(/Meal Name:\s*([^\n]+)/i);
    let mealName = nameMatch ? nameMatch[1].trim() : null;
    if (!mealName || mealName.toLowerCase() === '[name]') {
      const fallbackMatch = description.match(/(?:appears? to be|looks like|is a?n?) ([A-Za-z\s]+?)(?:\.|,|with|$)/i);
      mealName = fallbackMatch ? fallbackMatch[1].trim() : 'Uploaded meal';
    }

    res.json({
      mealName,
      description,
      imageBase64: `data:${mimeType};base64,${base64Image}`,
      ingredients: normalizeIngredients(ingredients)
    });
  } catch (err) {
    console.error('[MEALS] Analyze image error:', err.message);
    res.status(500).json({ error: 'Failed to analyze image. Please try again.' });
  }
});

/**
 * Normalise raw AI ingredient output into the canonical format used by the frontend.
 * Assigns unit, amountGrams, and selected fields.
 */
function normalizeIngredients(rawIngredients) {
  return rawIngredients.map(ing => {
    // Determine unit: use AI's suggestion if valid, otherwise infer from name
    const unit = (ing.unit && UNIT_PROFILES[ing.unit]) ? ing.unit : getBestUnit(ing.name);
    const profile = UNIT_PROFILES[unit] || UNIT_PROFILES['g'];

    // Use AI amount if sensible, otherwise profile default
    let amount = (typeof ing.amount === 'number' && ing.amount > 0) ? ing.amount : profile.defaultAmt;
    amount = Math.max(profile.min || 0.1, Math.min(profile.max || 9999, amount));

    // Calculate amountGrams for USDA lookup
    const amountGrams = ing.amountGrams
      ? ing.amountGrams
      : toGrams(amount, unit, ing.name);

    return {
      name: ing.name,
      amount,
      unit,
      amountGrams: Math.round(amountGrams * 10) / 10,
      isCommon: ing.isCommon !== false,
      category: ing.category || 'other',
      selected: ing.isCommon !== false
    };
  });
}

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
 * Look up an ingredient with automatic AI-powered retry on poor results.
 * Accepts both amountGrams directly and amount+unit for unit-based ingredients.
 */
async function lookupIngredientWithRetry(ing) {
  const { name } = ing;
  // Support both old API (amountGrams) and new (amount + unit → amountGrams)
  const amountGrams = ing.amountGrams
    ? ing.amountGrams
    : toGrams(ing.amount || 100, ing.unit || 'g', ing.name);

  let query = name;

  // First attempt
  let results = await searchIngredient(query, 3);
  let bestMatch = results[0];

  // Check if result is suspicious (0 or very low calories for non-zero food)
  const shouldRetry = !bestMatch ||
    bestMatch.caloriesPer100g === 0 ||
    (bestMatch.caloriesPer100g < 5 && !isLowCalorieFood(name));

  if (shouldRetry) {
    try {
      const retryResponse = await agentChat(
        [{ role: 'user', content: `Ingredient: "${name}", USDA search returned ${bestMatch ? `${bestMatch.caloriesPer100g} cal/100g` : 'no results'}. Better search term?` }],
        USDA_RETRY_SYSTEM,
        256
      );
      const retryData = parseAIJson(retryResponse);

      if (!retryData) {
        console.error('[MEALS] AI failed to return retry json. Raw response:', retryResponse);
      }

      if (retryData?.useEstimate) {
        const calories = calcCalories(retryData.estimatedCaloriesPer100g || 50, amountGrams);
        return {
          name,
          amount:      ing.amount || amountGrams,
          unit:        ing.unit || 'g',
          amountGrams,
          calories,
          protein: 0, carbs: 0, fat: 0,
          usdaDescription: `AI estimate (${retryData.reason})`,
          verified: false,
          retried: true
        };
      } else if (retryData?.retryQuery) {
        results = await searchIngredient(retryData.retryQuery, 3);
        bestMatch = results[0];
      }
    } catch (retryErr) {
      console.error('[MEALS] Retry error for', name, ':', retryErr.message);
    }
  }

  if (!bestMatch) {
    return {
      name,
      amount:      ing.amount || amountGrams,
      unit:        ing.unit || 'g',
      amountGrams,
      calories: Math.round(amountGrams * 0.5),
      protein: 0, carbs: 0, fat: 0,
      usdaDescription: 'Estimated (not found in database)',
      verified: false
    };
  }

  const calories = calcCalories(bestMatch.caloriesPer100g, amountGrams);
  const protein  = Math.round((bestMatch.proteinPer100g  * amountGrams) / 100 * 10) / 10;
  const carbs    = Math.round((bestMatch.carbsPer100g    * amountGrams) / 100 * 10) / 10;
  const fat      = Math.round((bestMatch.fatPer100g      * amountGrams) / 100 * 10) / 10;

  return {
    name,
    amount:      ing.amount || amountGrams,
    unit:        ing.unit || 'g',
    amountGrams,
    calories,
    protein,
    carbs,
    fat,
    usdaId:          String(bestMatch.fdcId),
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

    const verifyPrompt = `Meal Name: "${mealName}"
Total calories calculated: ${totalCalories} kcal

Ingredients breakdown:
${ingredients.map(i => `- ${i.name}: ${i.amount || i.amountGrams}${i.unit || 'g'} (≈${i.amountGrams || i.amount}g) = ${Math.round(i.calories || 0)} kcal`).join('\n')}

Please verify this meal's calorie accuracy.`;

    const response = await agentChat(
      [{ role: 'user', content: verifyPrompt }],
      VERIFY_SYSTEM,
      512
    );

    const verdict = parseAIJson(response);
    if (!verdict) {
      console.error('[MEALS] AI failed to verify calories. Raw response:', response);
      return res.json({
        reasonable: true,
        verdict: 'Unable to verify — proceeding with calculated values.',
        confidence: 'low',
        flaggedIngredients: [],
        mealNameOk: true
      });
    }

    // Ensure flaggedIngredients is always an array
    if (!Array.isArray(verdict.flaggedIngredients)) {
      verdict.flaggedIngredients = [];
    }

    res.json(verdict);
  } catch (err) {
    console.error('[MEALS] Verify error:', err.message);
    res.json({
      reasonable: true,
      verdict: 'Verification skipped due to an error.',
      confidence: 'low',
      flaggedIngredients: [],
      mealNameOk: true
    });
  }
});

// ── POST /api/meals/verify-edit ─────────────────────────────────────────────
// Re-verify after user modifies ingredient amounts/calories
router.post('/verify-edit', requireAuth, async (req, res) => {
  try {
    const { mealName, originalIngredients, editedIngredients, totalCalories } = req.body;

    const changes = editedIngredients
      .map(edited => {
        const orig = (originalIngredients || []).find(o => o.name === edited.name);
        if (!orig) return `- NEW: ${edited.name}: ${edited.amount || edited.amountGrams}${edited.unit || 'g'} = ${Math.round(edited.calories || 0)} kcal`;
        const amtChanged = orig.amount !== edited.amount || orig.amountGrams !== edited.amountGrams;
        const calChanged = Math.abs((orig.calories || 0) - (edited.calories || 0)) > 1;
        if (!amtChanged && !calChanged) return null;
        return `- ${edited.name}: was ${orig.amount || orig.amountGrams}${orig.unit || 'g'} (${Math.round(orig.calories || 0)} kcal) → now ${edited.amount || edited.amountGrams}${edited.unit || 'g'} (${Math.round(edited.calories || 0)} kcal)`;
      })
      .filter(Boolean);

    if (changes.length === 0) {
      return res.json({
        verdict: 'approve',
        message: 'No changes detected — everything looks good!',
        canLog: true,
        suggestedCorrections: []
      });
    }

    const editPrompt = `Meal: "${mealName}"
New total: ${totalCalories} kcal

User made the following changes to ingredient amounts/calories:
${changes.join('\n')}

Full updated ingredient list:
${editedIngredients.map(i => `- ${i.name}: ${i.amount || i.amountGrams}${i.unit || 'g'} = ${Math.round(i.calories || 0)} kcal`).join('\n')}

Please review these user edits.`;

    const response = await agentChat(
      [{ role: 'user', content: editPrompt }],
      VERIFY_AFTER_EDIT_SYSTEM,
      512
    );

    const verdict = parseAIJson(response);
    if (!verdict) {
      console.error('[MEALS] AI failed to verify edit. Raw response:', response);
      return res.json({
        verdict: 'approve',
        message: 'Looks good! Your edits have been noted.',
        canLog: true,
        suggestedCorrections: []
      });
    }

    if (!Array.isArray(verdict.suggestedCorrections)) {
      verdict.suggestedCorrections = [];
    }

    res.json(verdict);
  } catch (err) {
    console.error('[MEALS] Verify-edit error:', err.message);
    res.json({
      verdict: 'approve',
      message: 'Edit verification skipped due to an error. Proceeding with your values.',
      canLog: true,
      suggestedCorrections: []
    });
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

    const totalCalories = ingredients.reduce((sum, i) => sum + (i.calories || 0), 0);
    const totalProtein  = ingredients.reduce((sum, i) => sum + (i.protein  || 0), 0);
    const totalCarbs    = ingredients.reduce((sum, i) => sum + (i.carbs    || 0), 0);
    const totalFat      = ingredients.reduce((sum, i) => sum + (i.fat      || 0), 0);

    // Normalize ingredient fields
    const normalizedIngredients = ingredients.map(i => ({
      name:            i.name,
      amount:          i.amount ?? i.amountGrams ?? 100,
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
      totalCarbs:   Math.round(totalCarbs   * 10) / 10,
      totalFat:     Math.round(totalFat     * 10) / 10,
      aiVerdict:    aiVerdict?.verdict || null,
      localDate
    });

    await meal.save();

    const balance = await deductMealCalories(user._id, localDate, totalCalories);

    res.status(201).json({
      message: 'Meal logged successfully',
      meal: {
        id:            meal._id,
        name:          meal.name,
        totalCalories: meal.totalCalories,
        totalProtein:  meal.totalProtein,
        totalCarbs:    meal.totalCarbs,
        totalFat:      meal.totalFat,
        loggedAt:      meal.loggedAt
      },
      balance: {
        currentBalance:   balance.currentBalance,
        caloriesConsumed: balance.caloriesConsumed
      }
    });
  } catch (err) {
    console.error('[MEALS] Log error:', err.message);
    res.status(500).json({ error: 'Failed to log meal.' });
  }
});

// ── POST /api/meals/manual ──────────────────────────────────────────────────
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
        carbs:   Number(carbs)   || 0,
        fat:     Number(fat)     || 0,
        verified: false
      }],
      totalCalories: Number(calories),
      totalProtein:  Number(protein) || 0,
      totalCarbs:    Number(carbs)   || 0,
      totalFat:      Number(fat)     || 0,
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

    meal.editHistory.push({
      editedAt: new Date(),
      previousCalories: oldCalories,
      reason: reason || 'User requested edit',
      ptApproved: true,
      ptNote: ptNote || ''
    });

    meal.totalCalories = newCalories;
    if (meal.ingredients.length > 0) {
      meal.ingredients[0].set('calories', newCalories);
    }
    await meal.save();

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

    meal.isDeleted = true;
    meal.deletedAt = new Date();
    meal.deleteReason = reason || 'User requested deletion';
    meal.ptDeleteApproved = true;
    await meal.save();

    const localDate = getLocalDate(req.user.profile?.timezone);
    await reverseDeduction(req.user._id, localDate, meal.totalCalories);

    res.json({ message: 'Meal deleted successfully', restoredCalories: meal.totalCalories });
  } catch (err) {
    console.error('[MEALS] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete meal.' });
  }
});

// Export helpers for testing
module.exports = router;
module.exports._helpers = {
  getBestUnit,
  toGrams,
  normalizeIngredients,
  UNIT_PROFILES
};
