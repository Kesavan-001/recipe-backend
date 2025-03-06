// backend.js (Node.js Server)
const express = require('express');
const fetch = require('node-fetch'); // For HTTP requests in Node.js
const cors = require('cors'); // To allow frontend access
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

const YOUTUBE_API_KEY = 'AIzaSyCpDQL15wZ8qSYQBvJt-Ib5D0b84W-8-oU'; // Replace with your YouTube API key
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

let recipesData = [];
let ingredients = [];
let compareRecipes = [];
let favorites = [];
let mealPlan = [];
let shoppingList = [];

// Middleware
app.use(cors()); // Enable CORS for frontend
app.use(express.json()); // Parse JSON bodies
app.use(express.static(path.join(__dirname))); // Serve static files (HTML, CSS, JS)

// Load recipes from recipes.json at server start
async function loadRecipes() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8');
        recipesData = JSON.parse(data);
        recipesData.forEach((recipe, index) => {
            recipe.id = index + 1;
        });
        return recipesData;
    } catch (error) {
        console.error('Error loading recipes:', error);
        throw error;
    }
}

// Initialize recipes on server start
loadRecipes().then(() => {
    console.log('Recipes loaded successfully');
}).catch(err => {
    console.error('Failed to load recipes:', err);
});

// API Routes
app.get('/recipes', (req, res) => {
    res.json(recipesData);
});

app.get('/youtube-search', async (req, res) => {
    const { title } = req.query;
    const url = `${YOUTUBE_SEARCH_URL}?part=snippet&q=${encodeURIComponent(title + ' recipe in English')}&type=video&maxResults=1&relevanceLanguage=en&key=${YOUTUBE_API_KEY}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        const videoId = data.items && data.items.length > 0 ? data.items[0].id.videoId : null;
        res.json({ videoId });
    } catch (error) {
        console.error('Error searching YouTube:', error);
        res.status(500).json({ error: 'Failed to search YouTube' });
    }
});

app.get('/filter-recipes-by-name', (req, res) => {
    const { recipeName, cuisineFilter, maxTimeFilter, excludeIngredient } = req.query;
    let filteredRecipes = recipesData.filter(recipe => 
        recipe['TranslatedRecipeName'].toLowerCase().includes(recipeName.toLowerCase())
    );

    if (cuisineFilter) {
        filteredRecipes = filteredRecipes.filter(recipe => recipe.Cuisine.toLowerCase() === cuisineFilter.toLowerCase());
    }
    if (maxTimeFilter) {
        filteredRecipes = filteredRecipes.filter(recipe => recipe.TotalTimeInMins <= parseInt(maxTimeFilter));
    }
    if (excludeIngredient) {
        filteredRecipes = filteredRecipes.filter(recipe => 
            !recipe['Cleaned-Ingredients'].toLowerCase().includes(excludeIngredient.toLowerCase())
        );
    }

    const recipes = filteredRecipes.map(recipe => ({
        id: recipe.id,
        title: recipe['TranslatedRecipeName'],
        image: recipe['image-url'],
        missedIngredientCount: 0,
        missedIngredients: [],
        prepTime: recipe['TotalTimeInMins'],
        calories: recipe['Calories'] || 'Approx. ' + (Math.floor(Math.random() * 300) + 200),
        protein: recipe['Protein'] || 'Approx. ' + (Math.floor(Math.random() * 20) + 5) + 'g'
    }));
    res.json(recipes);
});

app.post('/filter-recipes-by-ingredients', (req, res) => {
    const userIngredients = req.body.ingredients;
    const recipes = recipesData.map(recipe => {
        const recipeIngredients = recipe['Cleaned-Ingredients'].split(',').map(ing => ing.trim().toLowerCase());
        const matchedIngredients = recipeIngredients.filter(ing => userIngredients.some(userIng => ing.includes(userIng)));
        const missingIngredients = recipeIngredients.filter(ing => !userIngredients.some(userIng => ing.includes(userIng)));
        return {
            id: recipe.id,
            title: recipe['TranslatedRecipeName'],
            image: recipe['image-url'],
            missedIngredientCount: missingIngredients.length,
            missedIngredients: missingIngredients,
            matchCount: matchedIngredients.length,
            prepTime: recipe['TotalTimeInMins'],
            calories: recipe['Calories'] || 'Approx. ' + (Math.floor(Math.random() * 300) + 200),
            protein: recipe['Protein'] || 'Approx. ' + (Math.floor(Math.random() * 20) + 5) + 'g'
        };
    })
    .filter(recipe => recipe.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount || a.missedIngredientCount - b.missedIngredientCount)
    .slice(0, 5);

    res.json(recipes);
});

app.post('/enrich-recipes', async (req, res) => {
    const { recipes, includeSubstitutions } = req.body;
    const enrichedRecipes = await enrichRecipesMinimal(recipes, includeSubstitutions);
    res.json(enrichedRecipes);
});

app.get('/recipe/:id', (req, res) => {
    const recipe = recipesData.find(r => r.id == req.params.id);
    if (recipe) {
        res.json(recipe);
    } else {
        res.status(404).json({ error: 'Recipe not found' });
    }
});

app.post('/search-history', (req, res) => {
    const { recipeName } = req.body;
    res.json(addToSearchHistory(recipeName));
});

app.get('/search-history', (req, res) => {
    res.json(getSearchHistory());
});

app.post('/favorites', (req, res) => {
    const { recipeId } = req.body;
    res.json(addToFavorites(recipeId));
});

app.delete('/favorites/:recipeId', (req, res) => {
    const recipeId = parseInt(req.params.recipeId);
    res.json(removeFromFavorites(recipeId));
});

app.get('/favorites', (req, res) => {
    res.json(getFavorites());
});

app.post('/meal-plan', (req, res) => {
    const { recipeId, date } = req.body;
    res.json(planMeal(recipeId, date));
});

app.delete('/meal-plan/:recipeId/:date', (req, res) => {
    const recipeId = parseInt(req.params.recipeId);
    const date = req.params.date;
    res.json(removeFromMealPlan(recipeId, date));
});

app.get('/meal-plan', (req, res) => {
    res.json(getMealPlan());
});

app.post('/shopping-list', (req, res) => {
    const { recipeId, missedIngredients } = req.body;
    res.json(addToShoppingList(recipeId, missedIngredients));
});

app.delete('/shopping-list/:index', (req, res) => {
    const index = parseInt(req.params.index);
    res.json(removeFromShoppingList(index));
});

app.get('/shopping-list', (req, res) => {
    res.json(getShoppingList());
});

app.post('/rate-recipe', (req, res) => {
    const { recipeId, rating } = req.body;
    res.json({ averageRating: rateRecipe(recipeId, rating) });
});

app.get('/rating/:recipeId', (req, res) => {
    const recipeId = parseInt(req.params.recipeId);
    res.json({ averageRating: getAverageRating(recipeId) });
});

app.get('/random-recipe', async (req, res) => {
    const randomRecipe = getRandomRecipe();
    const enrichedRecipe = await enrichRecipesMinimal(randomRecipe);
    res.json(enrichedRecipe);
});

// Backend helper functions
async function enrichRecipesMinimal(recipes, includeSubstitutions = false) {
    const substitutions = {
        'chicken': 'tofu',
        'beef': 'mushroom',
        'fish': 'tempeh',
        'egg': 'flaxseed',
        'milk': 'almond milk'
    };

    for (let recipe of recipes) {
        recipe.calories = recipe.calories || 'Approx. ' + (Math.floor(Math.random() * 300) + 200);
        recipe.protein = recipe.protein || 'Approx. ' + (Math.floor(Math.random() * 20) + 5) + 'g';
        recipe.image = recipe.image || 'https://via.placeholder.com/150';
        if (includeSubstitutions && recipe.missedIngredients) {
            recipe.substitutions = recipe.missedIngredients.map(ing => ({
                original: ing,
                substitute: substitutions[ing] || 'No substitute available'
            }));
        }
    }
    return recipes;
}

function addToSearchHistory(recipeName) {
    let history = getSearchHistory();
    if (!history.includes(recipeName)) {
        history.unshift(recipeName);
        if (history.length > 5) history.pop();
    }
    return history;
}

function getSearchHistory() {
    return JSON.parse(JSON.stringify(favorites)); // Simulate localStorage-like behavior
}

function addToFavorites(recipeId) {
    const recipe = recipesData.find(r => r.id === recipeId);
    if (recipe && !favorites.some(fav => fav.id === recipeId)) {
        favorites.push({ id: recipeId, title: recipe['TranslatedRecipeName'] });
    }
    return favorites;
}

function removeFromFavorites(recipeId) {
    favorites = favorites.filter(f => f.id !== recipeId);
    return favorites;
}

function getFavorites() {
    return favorites;
}

function planMeal(recipeId, date) {
    const recipe = recipesData.find(r => r.id === recipeId);
    if (recipe && date) {
        mealPlan.push({ id: recipeId, title: recipe['TranslatedRecipeName'], date: date });
    }
    return mealPlan;
}

function removeFromMealPlan(recipeId, date) {
    mealPlan = mealPlan.filter(m => !(m.id === recipeId && m.date === date));
    return mealPlan;
}

function getMealPlan() {
    return mealPlan;
}

function addToShoppingList(recipeId, missedIngredients) {
    const recipe = recipesData.find(r => r.id === recipeId);
    if (!recipe) return shoppingList;

    const ingredientsToAdd = missedIngredients.length > 0 ? missedIngredients : recipe['Cleaned-Ingredients'].split(',').map(ing => ing.trim());
    ingredientsToAdd.forEach(ingredient => {
        if (!shoppingList.includes(ingredient)) {
            shoppingList.push(ingredient);
        }
    });
    return shoppingList;
}

function removeFromShoppingList(index) {
    shoppingList.splice(index, 1);
    return shoppingList;
}

function getShoppingList() {
    return shoppingList;
}

function rateRecipe(recipeId, rating) {
    let ratings = {};
    ratings[recipeId] = ratings[recipeId] || [];
    ratings[recipeId].push(parseInt(rating));
    return getAverageRating(recipeId);
}

function getAverageRating(recipeId) {
    const ratings = {};
    const recipeRatings = ratings[recipeId] || [];
    return recipeRatings.length ? (recipeRatings.reduce((a, b) => a + b, 0) / recipeRatings.length).toFixed(1) : 0;
}

function getRandomRecipe() {
    const randomRecipe = recipesData[Math.floor(Math.random() * recipesData.length)];
    return [{
        id: randomRecipe.id,
        title: randomRecipe['TranslatedRecipeName'],
        image: randomRecipe['image-url'],
        missedIngredientCount: 0,
        missedIngredients: [],
        prepTime: randomRecipe['TotalTimeInMins'],
        calories: randomRecipe['Calories'] || 'Approx. ' + (Math.floor(Math.random() * 300) + 200),
        protein: randomRecipe['Protein'] || 'Approx. ' + (Math.floor(Math.random() * 20) + 5) + 'g'
    }];
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});