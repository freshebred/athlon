const axios = require('axios');

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';
const API_KEY = process.env.DATA_GOV_API_KEY;

/**
 * Search USDA FoodData Central for an ingredient
 * @param {string} query - Ingredient name to search
 * @param {number} maxResults - Max results to return
 * @returns {Array} List of food items with nutrient data
 */
async function searchIngredient(query, maxResults = 5) {
  // Sanitize: strip parenthetical extras, trailing descriptors, excess punctuation
  // e.g. "green onions (scallions), sliced" → "green onions"
  const clean = query
    .replace(/\s*\([^)]*\)/g, '')   // remove (anything in parens)
    .replace(/,.*$/,           '')   // remove everything after first comma
    .replace(/\b(e\.g\.|i\.e\.|or|and|fresh|frozen|raw|cooked|dried|sliced|diced|chopped|minced)\b/gi, '')
    .replace(/\s{2,}/g,        ' ')  // collapse spaces
    .trim()
    .slice(0, 60);                   // cap length

  const searchQuery = clean || query.slice(0, 60);

  try {
    const response = await axios.get(`${USDA_BASE}/foods/search`, {
      params: {
        query: searchQuery,
        api_key: API_KEY,
        pageSize: maxResults,
        dataType: 'Foundation,SR Legacy,Branded'
      },
      timeout: 8000
    });

    const foods = response.data?.foods || [];
    return foods.map(food => ({
      fdcId: food.fdcId,
      description: food.description,
      brandName: food.brandName || null,
      dataType: food.dataType,
      caloriesPer100g: extractNutrient(food.foodNutrients, 'Energy', 208),
      proteinPer100g:  extractNutrient(food.foodNutrients, 'Protein', 203),
      carbsPer100g:    extractNutrient(food.foodNutrients, 'Carbohydrate, by difference', 205),
      fatPer100g:      extractNutrient(food.foodNutrients, 'Total lipid (fat)', 204)
    }));
  } catch (err) {
    console.error(`USDA search error for "${searchQuery}":`, err.message);
    return [];
  }
}

/**
 * Extract a specific nutrient from USDA food nutrient array
 */
function extractNutrient(nutrients, name, nutrientId) {
  if (!nutrients || !Array.isArray(nutrients)) return 0;
  
  const nutrient = nutrients.find(n => 
    n.nutrientId === nutrientId || 
    n.nutrientName?.includes(name) ||
    n.name?.includes(name)
  );
  
  return nutrient?.value || nutrient?.amount || 0;
}

/**
 * Calculate calories for a given amount of an ingredient
 * @param {number} caloriesPer100g
 * @param {number} amountGrams
 * @returns {number} Calories for the given amount
 */
function calcCalories(caloriesPer100g, amountGrams) {
  return Math.round((caloriesPer100g * amountGrams) / 100);
}

module.exports = { searchIngredient, calcCalories };
