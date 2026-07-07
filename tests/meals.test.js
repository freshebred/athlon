/**
 * tests/meals.test.js
 * Tests for all /api/meals/* endpoints including analysis, logging, editing, deletion.
 * External AI (Groq) and USDA calls are mocked.
 */

const request = require('supertest');
jest.mock('../utils/groq');
jest.mock('../utils/usda', () => ({
  ...jest.requireActual('../utils/usda'),
  searchIngredient: jest.fn()  // only mock the network call
}));

const { buildApp, createUser, createMeal, createBalance, authHeader } = require('./helpers');
const { reasoningChat, agentChat, parseAIJson } = require('../utils/groq');
const { searchIngredient } = require('../utils/usda');
const MealLog    = require('../models/MealLog');
const DailyBalance = require('../models/DailyBalance');

let app, user;

beforeAll(() => {
  app = buildApp();
});

beforeEach(async () => {
  user = await createUser({ email: `meals-${Date.now()}@test.com` });
  await createBalance(user._id);

  // Default Groq mock responses
  reasoningChat.mockResolvedValue(JSON.stringify([
    { name: 'chicken breast', amountGrams: 150, isCommon: true,  category: 'protein' },
    { name: 'olive oil',      amountGrams: 15,  isCommon: true,  category: 'fat'     },
    { name: 'garlic',         amountGrams: 5,   isCommon: false, category: 'seasoning'}
  ]));

  agentChat.mockResolvedValue(JSON.stringify({
    reasonable: true,
    verdict: 'Looks reasonable',
    suggestedRange: { min: 200, max: 500 },
    confidence: 'high'
  }));

  parseAIJson.mockImplementation((text) => {
    try { return JSON.parse(text); } catch { return null; }
  });

  // Default USDA mock
  searchIngredient.mockResolvedValue([{
    fdcId: 1001,
    description: 'Chicken, breast, raw',
    caloriesPer100g: 165,
    proteinPer100g:  31,
    carbsPer100g:    0,
    fatPer100g:      3.6
  }]);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/meals/analyze-name', () => {
  it('should return ingredient list for valid meal name', async () => {
    const res = await request(app)
      .post('/api/meals/analyze-name')
      .set(authHeader(user))
      .send({ mealName: 'Grilled Chicken' });

    expect(res.status).toBe(200);
    expect(res.body.mealName).toBe('Grilled Chicken');
    expect(Array.isArray(res.body.ingredients)).toBe(true);
    expect(res.body.ingredients.length).toBeGreaterThan(0);
    // Common ingredients should be pre-selected
    const common = res.body.ingredients.filter(i => i.selected);
    expect(common.length).toBeGreaterThan(0);
  });

  it('should return 400 if meal name is missing', async () => {
    const res = await request(app)
      .post('/api/meals/analyze-name')
      .set(authHeader(user))
      .send({ mealName: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/meals/analyze-name')
      .send({ mealName: 'Pizza' });

    expect(res.status).toBe(401);
  });

  it('should handle AI returning invalid JSON gracefully', async () => {
    reasoningChat.mockResolvedValueOnce('this is not json at all');
    parseAIJson.mockReturnValueOnce(null);

    const res = await request(app)
      .post('/api/meals/analyze-name')
      .set(authHeader(user))
      .send({ mealName: 'Mystery Meal' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to analyze/i);
  });

  it('should trim whitespace from meal name', async () => {
    const res = await request(app)
      .post('/api/meals/analyze-name')
      .set(authHeader(user))
      .send({ mealName: '  Pasta  ' });

    expect(res.status).toBe(200);
    expect(res.body.mealName).toBe('Pasta');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/meals/usda-lookup', () => {
  it('should look up ingredients and return calorie data', async () => {
    const res = await request(app)
      .post('/api/meals/usda-lookup')
      .set(authHeader(user))
      .send({
        ingredients: [
          { name: 'chicken breast', amountGrams: 150 },
          { name: 'olive oil',      amountGrams: 15  }
        ]
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.ingredients)).toBe(true);
    expect(res.body.ingredients).toHaveLength(2);
    expect(res.body.ingredients[0]).toHaveProperty('calories');
    expect(res.body.ingredients[0]).toHaveProperty('protein');
  });

  it('should return 400 when ingredients array is missing', async () => {
    const res = await request(app)
      .post('/api/meals/usda-lookup')
      .set(authHeader(user))
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 when ingredients array is empty', async () => {
    const res = await request(app)
      .post('/api/meals/usda-lookup')
      .set(authHeader(user))
      .send({ ingredients: [] });

    expect(res.status).toBe(400);
  });

  it('should use fallback estimate when USDA returns no results', async () => {
    searchIngredient.mockResolvedValue([]);
    agentChat.mockResolvedValueOnce(JSON.stringify({
      retryQuery: 'chicken',
      useEstimate: false,
      reason: 'generic term'
    }));
    parseAIJson.mockImplementationOnce((text) => {
      try { return JSON.parse(text); } catch { return null; }
    });
    // second USDA call also returns nothing
    searchIngredient.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/meals/usda-lookup')
      .set(authHeader(user))
      .send({ ingredients: [{ name: 'unobtainium', amountGrams: 100 }] });

    expect(res.status).toBe(200);
    expect(res.body.ingredients[0].verified).toBe(false);
    expect(res.body.ingredients[0].calories).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/meals/verify', () => {
  it('should verify calorie total and return verdict', async () => {
    agentChat.mockResolvedValueOnce(JSON.stringify({
      reasonable: true,
      verdict: 'Calories look correct for grilled chicken',
      suggestedRange: { min: 300, max: 500 },
      confidence: 'high'
    }));
    parseAIJson.mockImplementationOnce((text) => JSON.parse(text));

    const res = await request(app)
      .post('/api/meals/verify')
      .set(authHeader(user))
      .send({
        mealName:      'Grilled Chicken',
        totalCalories: 400,
        ingredients:   [{ name: 'chicken breast', amountGrams: 150, calories: 400 }]
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reasonable');
    expect(res.body).toHaveProperty('verdict');
    expect(res.body).toHaveProperty('confidence');
  });

  it('should return graceful fallback if AI fails', async () => {
    agentChat.mockRejectedValueOnce(new Error('AI unavailable'));

    const res = await request(app)
      .post('/api/meals/verify')
      .set(authHeader(user))
      .send({ mealName: 'Test', totalCalories: 300, ingredients: [] });

    expect(res.status).toBe(200);
    expect(res.body.reasonable).toBe(true);
    expect(res.body.confidence).toBe('low');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/meals/log', () => {
  it('should log a meal and deduct calories from balance', async () => {
    const ingredients = [
      { name: 'chicken breast', amountGrams: 150, calories: 247, protein: 46, carbs: 0, fat: 5.4, verified: true },
      { name: 'olive oil',      amountGrams: 15,  calories: 119, protein: 0,  carbs: 0, fat: 13.5, verified: true }
    ];

    const res = await request(app)
      .post('/api/meals/log')
      .set(authHeader(user))
      .send({
        name:        'Grilled Chicken',
        logType:     'ai_name',
        ingredients,
        aiVerdict:   { verdict: 'Reasonable estimate' }
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/logged/i);
    expect(res.body.meal.totalCalories).toBe(366);
    expect(res.body.balance).toHaveProperty('currentBalance');
    expect(res.body.balance.currentBalance).toBe(2200 - 366);

    // Verify the meal is in DB
    const meal = await MealLog.findById(res.body.meal.id);
    expect(meal).not.toBeNull();
    expect(meal.name).toBe('Grilled Chicken');
  });

  it('should return 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/meals/log')
      .set(authHeader(user))
      .send({ ingredients: [{ name: 'food', calories: 100 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('should return 400 when ingredients are missing', async () => {
    const res = await request(app)
      .post('/api/meals/log')
      .set(authHeader(user))
      .send({ name: 'Mystery Meal' });

    expect(res.status).toBe(400);
  });

  it('should calculate macros correctly from ingredients', async () => {
    const ingredients = [
      { name: 'A', amountGrams: 100, calories: 200, protein: 10, carbs: 20, fat: 5,  verified: true },
      { name: 'B', amountGrams: 50,  calories: 100, protein: 5,  carbs: 10, fat: 2.5, verified: true }
    ];

    const res = await request(app)
      .post('/api/meals/log')
      .set(authHeader(user))
      .send({ name: 'Combo Meal', logType: 'ai_name', ingredients });

    expect(res.status).toBe(201);
    expect(res.body.meal.totalCalories).toBe(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/meals/manual', () => {
  it('should log a manual meal entry', async () => {
    const res = await request(app)
      .post('/api/meals/manual')
      .set(authHeader(user))
      .send({ name: 'Quick Snack', calories: 150 });

    expect(res.status).toBe(201);
    expect(res.body.meal.totalCalories).toBe(150);
    expect(res.body.balance).toHaveProperty('currentBalance');
  });

  it('should return 400 if calories is missing', async () => {
    const res = await request(app)
      .post('/api/meals/manual')
      .set(authHeader(user))
      .send({ name: 'No Cal Meal' });

    expect(res.status).toBe(400);
  });

  it('should return 400 if name is missing', async () => {
    const res = await request(app)
      .post('/api/meals/manual')
      .set(authHeader(user))
      .send({ calories: 300 });

    expect(res.status).toBe(400);
  });

  it('should accept optional macro fields', async () => {
    const res = await request(app)
      .post('/api/meals/manual')
      .set(authHeader(user))
      .send({ name: 'Lunch', calories: 500, protein: 30, carbs: 60, fat: 15 });

    expect(res.status).toBe(201);
    const meal = await MealLog.findById(res.body.meal.id);
    expect(meal.totalProtein).toBe(30);
    expect(meal.totalCarbs).toBe(60);
    expect(meal.totalFat).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/meals/today', () => {
  it('should return meals logged today', async () => {
    await createMeal(user._id);
    await createMeal(user._id, { name: 'Lunch' });

    const res = await request(app)
      .get('/api/meals/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.meals)).toBe(true);
  });

  it('should not return soft-deleted meals', async () => {
    await createMeal(user._id, { isDeleted: true });
    await createMeal(user._id, { name: 'Visible Meal', isDeleted: false });

    const res = await request(app)
      .get('/api/meals/today')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.meals.every(m => !m.isDeleted)).toBe(true);
  });

  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/meals/today');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/meals/history', () => {
  it('should return paginated meal history', async () => {
    await createMeal(user._id, { localDate: '2026-07-05', name: 'Old Meal 1' });
    await createMeal(user._id, { localDate: '2026-07-06', name: 'Old Meal 2' });

    const res = await request(app)
      .get('/api/meals/history?page=1')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.meals)).toBe(true);
    expect(res.body.grouped).toBeDefined();
  });

  it('should group meals by date in response', async () => {
    await createMeal(user._id, { localDate: '2026-07-05' });
    await createMeal(user._id, { localDate: '2026-07-06' });

    const res = await request(app)
      .get('/api/meals/history')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.grouped).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/meals/:id', () => {
  it('should update meal calories when PT approved', async () => {
    const meal = await createMeal(user._id, { totalCalories: 400 });

    const res = await request(app)
      .put(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ newCalories: 350, reason: 'Corrected portion', ptApproved: true, ptNote: 'PT verified' });

    expect(res.status).toBe(200);
    expect(res.body.meal.totalCalories).toBe(350);
  });

  it('should return 403 when PT approval is missing', async () => {
    const meal = await createMeal(user._id);

    const res = await request(app)
      .put(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ newCalories: 300, ptApproved: false });

    expect(res.status).toBe(403);
    expect(res.body.requiresPT).toBe(true);
    expect(res.body.error).toMatch(/PT Coach/i);
  });

  it('should return 404 for non-existent meal', async () => {
    const { Types } = require('mongoose');
    const fakeId = new Types.ObjectId();

    const res = await request(app)
      .put(`/api/meals/${fakeId}`)
      .set(authHeader(user))
      .send({ newCalories: 300, ptApproved: true });

    expect(res.status).toBe(404);
  });

  it('should record edit history when updating', async () => {
    const meal = await createMeal(user._id, { totalCalories: 400 });

    await request(app)
      .put(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ newCalories: 350, ptApproved: true, reason: 'PT agreed' });

    const updated = await MealLog.findById(meal._id);
    expect(updated.editHistory.length).toBeGreaterThan(0);
    expect(updated.editHistory[0].previousCalories).toBe(400);
    expect(updated.editHistory[0].ptApproved).toBe(true);
  });

  it('should not allow editing another user\'s meal', async () => {
    const otherUser = await createUser({ email: `other-${Date.now()}@test.com` });
    const meal = await createMeal(otherUser._id);

    const res = await request(app)
      .put(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ newCalories: 300, ptApproved: true });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/meals/:id', () => {
  it('should soft-delete a meal when PT approved', async () => {
    const meal = await createMeal(user._id, { totalCalories: 300 });

    const res = await request(app)
      .delete(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ ptApproved: true, reason: 'Error entry' });

    expect(res.status).toBe(200);
    expect(res.body.restoredCalories).toBe(300);

    // Meal should be soft-deleted
    const found = await MealLog.findById(meal._id);
    expect(found.isDeleted).toBe(true);
    expect(found.deletedAt).toBeDefined();
  });

  it('should return 403 and requiresPT when PT not approved', async () => {
    const meal = await createMeal(user._id);

    const res = await request(app)
      .delete(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ ptApproved: false });

    expect(res.status).toBe(403);
    expect(res.body.requiresPT).toBe(true);
    expect(res.body.mealId).toBeDefined();
  });

  it('should return 404 for non-existent meal', async () => {
    const { Types } = require('mongoose');
    const fakeId = new Types.ObjectId();

    const res = await request(app)
      .delete(`/api/meals/${fakeId}`)
      .set(authHeader(user))
      .send({ ptApproved: true });

    expect(res.status).toBe(404);
  });

  it('should restore calories to balance after deletion', async () => {
    const meal = await createMeal(user._id, { totalCalories: 500 });
    // First manually deduct from balance
    const balance = await DailyBalance.findOne({ userId: user._id });
    balance.caloriesConsumed = 500;
    balance.currentBalance = 2200 - 500;
    await balance.save();

    await request(app)
      .delete(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ ptApproved: true });

    const updated = await DailyBalance.findOne({ userId: user._id });
    expect(updated.caloriesConsumed).toBe(0);
    expect(updated.currentBalance).toBe(2200);
  });

  it('should not allow deleting another user\'s meal', async () => {
    const otherUser = await createUser({ email: `del-other-${Date.now()}@test.com` });
    const meal = await createMeal(otherUser._id);

    const res = await request(app)
      .delete(`/api/meals/${meal._id}`)
      .set(authHeader(user))
      .send({ ptApproved: true });

    expect(res.status).toBe(404);
  });
});
