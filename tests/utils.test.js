/**
 * tests/utils.test.js
 * Unit tests for utility functions:
 *   - utils/balance.js: getLocalDate, getPreviousDate, deductMealCalories,
 *                        addWorkoutCalories, reverseDeduction, getTodayBalance
 *   - utils/groq.js: parseAIJson
 *   - utils/usda.js: calcCalories, searchIngredient (mocked)
 *   - models/User.js: calculateTDEE
 */

const mongoose = require('mongoose');
jest.mock('../utils/groq', () => ({
  ...jest.requireActual('../utils/groq'),
  agentChat:      jest.fn(),
  reasoningChat:  jest.fn(),
  analyzeImage:   jest.fn(),
  checkUserInput: jest.fn().mockResolvedValue({ safe: true })
}));

const { createUser, createBalance } = require('./helpers');
const { getLocalDate, deductMealCalories, addWorkoutCalories, reverseDeduction, getTodayBalance } = require('../utils/balance');
const { calcCalories }  = require('../utils/usda');
const { parseAIJson }   = require('../utils/groq');
const User              = require('../models/User');
const DailyBalance      = require('../models/DailyBalance');

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/balance.js — getLocalDate', () => {
  it('should return YYYY-MM-DD format', () => {
    const date = getLocalDate('America/Chicago');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should accept different timezones without throwing', () => {
    expect(() => getLocalDate('America/New_York')).not.toThrow();
    expect(() => getLocalDate('Asia/Tokyo')).not.toThrow();
    expect(() => getLocalDate('Europe/London')).not.toThrow();
  });

  it('should fall back to America/Chicago when timezone is undefined', () => {
    const date = getLocalDate(undefined);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/balance.js — getTodayBalance', () => {
  let user;

  beforeEach(async () => {
    user = await createUser({ email: `util-balance-${Date.now()}@test.com` });
  });

  it('should create a new balance if one does not exist', async () => {
    const localDate = '2026-07-07';
    const balance = await getTodayBalance(user._id, localDate);

    expect(balance).toBeDefined();
    expect(balance.openingBalance).toBe(user.profile.tdee);
    expect(balance.currentBalance).toBe(user.profile.tdee);
    expect(balance.caloriesConsumed).toBe(0);
    expect(balance.caloriesBurnt).toBe(0);
  });

  it('should return existing balance if already created', async () => {
    await createBalance(user._id, { localDate: '2026-07-07', caloriesConsumed: 300 });
    const balance = await getTodayBalance(user._id, '2026-07-07');

    expect(balance.caloriesConsumed).toBe(300);
  });

  it('should apply negative carryover from previous day with negative balance', async () => {
    // Create a previous day with negative balance (debt)
    await DailyBalance.create({
      userId:          user._id,
      localDate:       '2026-07-06',
      openingBalance:  2200,
      carryover:       0,
      caloriesConsumed: 2800,
      caloriesBurnt:   0,
      currentBalance:  -600,
      closed:          false
    });

    const balance = await getTodayBalance(user._id, '2026-07-07');

    expect(balance.carryover).toBe(-600);
    expect(balance.currentBalance).toBe(2200 + (-600)); // 1600
  });

  it('should NOT carry over positive balance from previous day', async () => {
    // Create a previous day with positive balance (surplus)
    await DailyBalance.create({
      userId:          user._id,
      localDate:       '2026-07-06',
      openingBalance:  2200,
      carryover:       0,
      caloriesConsumed: 1500,
      caloriesBurnt:   0,
      currentBalance:  700,
      closed:          false
    });

    const balance = await getTodayBalance(user._id, '2026-07-07');

    // Positive balance doesn't carry forward
    expect(balance.carryover).toBe(0);
    expect(balance.currentBalance).toBe(2200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/balance.js — deductMealCalories', () => {
  let user;

  beforeEach(async () => {
    user = await createUser({ email: `util-deduct-${Date.now()}@test.com` });
    await createBalance(user._id);
  });

  it('should increase caloriesConsumed and decrease currentBalance', async () => {
    const balance = await deductMealCalories(user._id, '2026-07-07', 500);

    expect(balance.caloriesConsumed).toBe(500);
    expect(balance.currentBalance).toBe(2200 - 500);
  });

  it('should accumulate multiple meal deductions', async () => {
    await deductMealCalories(user._id, '2026-07-07', 300);
    const balance = await deductMealCalories(user._id, '2026-07-07', 200);

    expect(balance.caloriesConsumed).toBe(500);
    expect(balance.currentBalance).toBe(2200 - 500);
  });

  it('should allow balance to go negative', async () => {
    const balance = await deductMealCalories(user._id, '2026-07-07', 3000);
    expect(balance.currentBalance).toBe(2200 - 3000); // -800
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/balance.js — addWorkoutCalories', () => {
  let user;

  beforeEach(async () => {
    user = await createUser({ email: `util-workout-${Date.now()}@test.com` });
    await createBalance(user._id);
  });

  it('should increase caloriesBurnt and currentBalance', async () => {
    const balance = await addWorkoutCalories(user._id, '2026-07-07', 300);

    expect(balance.caloriesBurnt).toBe(300);
    expect(balance.currentBalance).toBe(2200 + 300);
  });

  it('should accumulate multiple workout additions', async () => {
    await addWorkoutCalories(user._id, '2026-07-07', 200);
    const balance = await addWorkoutCalories(user._id, '2026-07-07', 150);

    expect(balance.caloriesBurnt).toBe(350);
    expect(balance.currentBalance).toBe(2200 + 350);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/balance.js — reverseDeduction', () => {
  let user;

  beforeEach(async () => {
    user = await createUser({ email: `util-reverse-${Date.now()}@test.com` });
    const balance = await createBalance(user._id);
    balance.caloriesConsumed = 600;
    balance.currentBalance = 2200 - 600;
    await balance.save();
  });

  it('should decrease caloriesConsumed and increase currentBalance', async () => {
    const balance = await reverseDeduction(user._id, '2026-07-07', 300);

    expect(balance.caloriesConsumed).toBe(300);
    expect(balance.currentBalance).toBe(2200 - 300);
  });

  it('should not allow caloriesConsumed to go below 0', async () => {
    // Only 600 consumed; try to reverse 800
    const balance = await reverseDeduction(user._id, '2026-07-07', 800);

    expect(balance.caloriesConsumed).toBe(0);
  });

  it('should return null if no balance record exists', async () => {
    const result = await reverseDeduction(
      new mongoose.Types.ObjectId(),
      '2099-01-01',
      100
    );
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/groq.js — parseAIJson (actual implementation)', () => {
  // Use the real implementation for these unit tests
  const { parseAIJson: realParse } = jest.requireActual('../utils/groq');

  it('should parse plain JSON string', () => {
    const result = realParse('{"key": "value", "num": 42}');
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('should parse JSON wrapped in markdown code fences', () => {
    const result = realParse('```json\n{"message": "hello"}\n```');
    expect(result).toEqual({ message: 'hello' });
  });

  it('should extract JSON from surrounding text', () => {
    const result = realParse('Some preamble text {"key": "found"} trailing text');
    expect(result).toEqual({ key: 'found' });
  });

  it('should return null for completely unparseable text', () => {
    const result = realParse('this is just plain text with no JSON');
    expect(result).toBeNull();
  });

  it('should parse JSON arrays', () => {
    const result = realParse('[{"name": "a"}, {"name": "b"}]');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('should handle empty string', () => {
    const result = realParse('');
    expect(result).toBeNull();
  });

  it('should handle code block without json label', () => {
    const result = realParse('```\n{"test": true}\n```');
    expect(result).toEqual({ test: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/usda.js — calcCalories', () => {
  it('should calculate calories correctly', () => {
    expect(calcCalories(165, 100)).toBe(165);  // 165 kcal/100g × 100g = 165
    expect(calcCalories(165, 150)).toBe(248);  // 165 × 150/100 = 247.5 → 248
    expect(calcCalories(9, 50)).toBe(5);       // 9 × 50/100 = 4.5 → 5
    expect(calcCalories(0, 100)).toBe(0);      // 0 kcal food
  });

  it('should round to nearest integer', () => {
    expect(calcCalories(100, 33)).toBe(33);    // 100 × 33/100 = 33
    expect(calcCalories(100, 167)).toBe(167);  // 100 × 167/100 = 167
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('models/User.js — calculateTDEE', () => {
  it('should calculate TDEE for a male user (Mifflin-St Jeor)', () => {
    const user = new User({
      name: 'Test',
      email: 'tdee@test.com',
      password: 'hash',
      profile: { age: 25, weight: 70, height: 175, sex: 'male', activityLevel: 'moderate', goal: 'maintain' }
    });

    const tdee = user.calculateTDEE();
    // BMR = 10*70 + 6.25*175 - 5*25 + 5 = 700 + 1093.75 - 125 + 5 = 1673.75
    // TDEE = 1673.75 × 1.55 = 2594.3 ≈ 2594
    expect(tdee).toBe(2594);
  });

  it('should calculate TDEE for a female user', () => {
    const user = new User({
      name: 'Test',
      email: 'tdee-f@test.com',
      password: 'hash',
      profile: { age: 30, weight: 60, height: 165, sex: 'female', activityLevel: 'sedentary', goal: 'maintain' }
    });

    const tdee = user.calculateTDEE();
    // BMR = 10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161 = 1320.25
    // TDEE = 1320.25 × 1.2 = 1584.3 ≈ 1584
    expect(tdee).toBe(1584);
  });

  it('should apply calorie deficit for "lose" goal', () => {
    const user = new User({
      name: 'Test',
      email: 'lose@test.com',
      password: 'hash',
      profile: { age: 25, weight: 70, height: 175, sex: 'male', activityLevel: 'moderate', goal: 'lose' }
    });

    const tdee = user.calculateTDEE();
    expect(tdee).toBe(2594 - 500); // 2094
  });

  it('should add calories for "gain" goal', () => {
    const user = new User({
      name: 'Test',
      email: 'gain@test.com',
      password: 'hash',
      profile: { age: 25, weight: 70, height: 175, sex: 'male', activityLevel: 'moderate', goal: 'gain' }
    });

    const tdee = user.calculateTDEE();
    expect(tdee).toBe(2594 + 300); // 2894
  });

  it('should return null if profile data is incomplete', () => {
    const user = new User({
      name: 'Incomplete',
      email: 'incomplete@test.com',
      password: 'hash',
      profile: { age: 25 } // missing weight, height, sex
    });

    const tdee = user.calculateTDEE();
    expect(tdee).toBeNull();
  });

  it('should handle very_active activity level', () => {
    const user = new User({
      name: 'Test',
      email: 'va@test.com',
      password: 'hash',
      profile: { age: 25, weight: 70, height: 175, sex: 'male', activityLevel: 'very_active', goal: 'maintain' }
    });

    const tdeeVA = user.calculateTDEE();
    // Should be higher than moderate (2594)
    expect(tdeeVA).toBeGreaterThan(2594);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('models/User.js — comparePassword', () => {
  it('should return true for correct password', async () => {
    const user = await createUser({ email: `compare-${Date.now()}@test.com` });
    const isMatch = await user.comparePassword('password123');
    expect(isMatch).toBe(true);
  });

  it('should return false for incorrect password', async () => {
    const user = await createUser({ email: `compare2-${Date.now()}@test.com` });
    const isMatch = await user.comparePassword('wrongpassword');
    expect(isMatch).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/groq.js — hasLeakedInternals', () => {
  // Import the real implementation (not the mock) for unit testing
  const { hasLeakedInternals, sanitiseAIResponse } = jest.requireActual('../utils/groq');

  it('should detect <tool_call> XML blocks', () => {
    expect(hasLeakedInternals('Hello <tool_call>{"action":"search"}</tool_call> world')).toBe(true);
  });

  it('should detect raw JSON blobs from tool calls', () => {
    expect(hasLeakedInternals('Here is the data: {"USDA_search": "chicken"}')).toBe(true);
  });

  it('should detect [TOOL_CALL] markers', () => {
    expect(hasLeakedInternals('[TOOL_CALL] some data [/TOOL_CALL]')).toBe(true);
  });

  it('should return false for clean responses', () => {
    expect(hasLeakedInternals('Great! Your chicken breast has about 247 calories.')).toBe(false);
  });

  it('should return false for empty/null input', () => {
    expect(hasLeakedInternals(null)).toBe(false);
    expect(hasLeakedInternals('')).toBe(false);
    expect(hasLeakedInternals(undefined)).toBe(false);
  });

  it('should return false for JSON that is not tool-related', () => {
    expect(hasLeakedInternals('Here is a recipe: {"name": "pasta", "calories": 400}')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/groq.js — sanitiseAIResponse', () => {
  const { sanitiseAIResponse } = jest.requireActual('../utils/groq');

  it('should remove <tool_call> XML blocks', () => {
    const input = 'Here is my answer. <tool_call>{"action":"search"}</tool_call> Hope that helps!';
    const output = sanitiseAIResponse(input);
    expect(output).not.toMatch(/<tool_call>/);
    expect(output).toContain('Here is my answer.');
  });

  it('should preserve clean response content', () => {
    const input = 'Your meal has about 400 calories. Good job tracking!';
    expect(sanitiseAIResponse(input)).toBe(input);
  });

  it('should handle null/undefined gracefully', () => {
    expect(sanitiseAIResponse(null)).toBeNull();
    expect(sanitiseAIResponse(undefined)).toBeUndefined();
    expect(sanitiseAIResponse('')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('utils/groq.js — parseAIJson', () => {
  const { parseAIJson } = jest.requireActual('../utils/groq');

  it('should parse plain JSON', () => {
    const result = parseAIJson('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON in markdown code blocks', () => {
    const result = parseAIJson('```json\n{"key": "value"}\n```');
    expect(result).toEqual({ key: 'value' });
  });

  it('should return null for invalid JSON', () => {
    expect(parseAIJson('not json at all')).toBeNull();
  });

  it('should extract JSON from mixed text', () => {
    const result = parseAIJson('Some text before {"key": "value"} some text after');
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON arrays', () => {
    const result = parseAIJson('[{"name": "egg"}, {"name": "salt"}]');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });
});
