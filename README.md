# Athlon — AI-Powered Calorie Bank

> Your daily calories as a bank account. Spend wisely. Earn from workouts.

## Tech Stack
- **Backend**: Node.js + Express.js
- **Database**: MongoDB (Atlas/Cosmos)
- **AI**: Groq API
  - `meta-llama/llama-4-scout-17b-16e-instruct` — food image analysis
  - `openai/gpt-oss-120b` — ingredient reasoning & assessment
  - `llama-3.3-70b-versatile` — main agent, PT Coach, all other tasks
- **Nutrition Data**: USDA FoodData Central API
- **Push Notifications**: Web Push (VAPID)
- **Frontend**: Vanilla JS/HTML/CSS (PWA)

## Project Structure

```
tracker/
├── server.js              # Main Express server
├── cron-notify.js         # Meal reminder cron script
├── pt-coach-prompt.md     # Max (PT Coach) system prompt
├── generate-vapid.js      # VAPID key generator (one-time use)
├── .env                   # Environment variables
├── models/
│   ├── User.js            # User schema (profile, TDEE, notifications)
│   ├── MealLog.js         # Meal logging (ingredients, macros, USDA data)
│   ├── WorkoutLog.js      # Workout logging (AI-verified, calorie earned)
│   ├── PTConversation.js  # PT Coach chat history + memory notes
│   └── DailyBalance.js    # Daily calorie bank ledger
├── routes/
│   ├── auth.js            # Register, login, logout, /me
│   ├── onboarding.js      # AI conversational onboarding
│   ├── meals.js           # Meal analysis, USDA lookup, logging, edit/delete
│   ├── workouts.js        # Workout verification, calorie estimation, logging
│   ├── balance.js         # Daily balance dashboard data
│   ├── ptCoach.js         # PT Coach chat with dispute resolution
│   ├── notifications.js   # Web Push subscription management
│   └── user.js            # Profile CRUD, stats
├── middleware/
│   └── auth.js            # JWT authentication middleware
├── utils/
│   ├── groq.js            # Groq API client (3 model tiers)
│   ├── usda.js            # USDA FoodData Central API client
│   └── balance.js         # Daily balance ledger helpers
└── public/                # Static PWA frontend
    ├── index.html
    ├── manifest.json
    ├── sw.js              # Service Worker
    ├── css/main.css
    ├── js/
    │   ├── api.js         # API client + helpers
    │   ├── app.js         # SPA router
    │   ├── auth.js        # Login/Register
    │   ├── onboarding.js  # AI chat onboarding
    │   ├── home.js        # Dashboard tab
    │   ├── log.js         # Meal logging tab
    │   ├── earn.js        # Workout earn tab
    │   ├── history.js     # History tab
    │   ├── profile.js     # Profile tab
    │   └── pt-coach.js    # PT Coach floating chat
    └── icons/             # PWA icons (all sizes)
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (edit .env)
# All keys are already set in .env

# 3. Start the server
npm start

# Dev mode (with file watching)
npm run dev
```

## Environment Variables

```env
DB_URI=             # MongoDB connection string
GROQ_API_KEY=       # Groq API key
DATA_GOV_API_KEY=   # USDA FoodData Central API key
JWT_SECRET=         # JWT signing secret
VAPID_PUBLIC_KEY=   # Web Push VAPID public key
VAPID_PRIVATE_KEY=  # Web Push VAPID private key
VAPID_EMAIL=        # VAPID contact email
PORT=3000
```

## Setting Up the Cron Job

The notification system requires a cron job that runs every 5 minutes:

```bash
# Edit your crontab
crontab -e

# Add this line (adjust path as needed):
*/5 * * * * cd /home/freshebred/Desktop/work/tracker && node cron-notify.js >> /var/log/athlon-cron.log 2>&1
```

The script:
1. Fetches all users with notifications enabled
2. Checks each user's local time against their notification windows (±5 min)
3. Verifies they haven't already logged in that meal period
4. Sends a Web Push notification with their current balance

## Key Features

### 🏦 Calorie Bank
- 1 calorie = $1 (your daily TDEE is your budget)
- Positive balance: you're on track ✅
- Negative balance (overdraft): debt carries to tomorrow
- End of day: positive resets, negative carries forward

### 🍽️ Smart Meal Logging
1. **By Name**: Enter meal name → AI lists all possible ingredients → ingredient grid → USDA lookup → confirm
2. **By Photo**: Take a photo → vision AI describes food → ingredient assessment → same flow
3. **Manual**: Enter name + calories directly

### 💪 Workout Earnings
- Take a workout photo → AI verifies you're actually working out
- Describe the workout → AI estimates calories (always -10% conservative)
- Earnings added to your balance
- Dispute unfair estimates with Max (PT Coach)

### 🤖 PT Coach (Max)
- Full access to all your data (balance, meals, workouts, history)
- Resolve disputes about meal calories or workout estimates
- General coaching, motivation, nutrition advice
- All decisions saved as memory notes for future context
- Accessed via floating button (bottom-right) at all times

### 🔔 Notifications
- Web Push via Service Worker
- Default reminders: 10am (Breakfast), 1pm (Lunch), 8pm (Dinner) in your local timezone
- Customizable via Profile tab
- Only notifies if you haven't logged in that meal period

## AI Model Configuration

| Task | Model | Notes |
|------|-------|-------|
| Food photo description | `meta-llama/llama-4-scout-17b-16e-instruct` | Vision model |
| Ingredient assessment | `openai/gpt-oss-120b` | Complex reasoning |
| Calorie verification | `llama-3.3-70b-versatile` | Agent tasks |
| USDA retry logic | `llama-3.3-70b-versatile` | Search optimization |
| PT Coach (Max) | `llama-3.3-70b-versatile` | Persistent coaching |
| Workout verification | `meta-llama/llama-4-scout-17b-16e-instruct` | Vision model |
| Onboarding chat | `llama-3.3-70b-versatile` | Conversational |

## TDEE Formula (Mifflin-St Jeor)

```
BMR (Male)   = 10W + 6.25H - 5A + 5
BMR (Female) = 10W + 6.25H - 5A - 161

TDEE = BMR × Activity Multiplier
  sedentary   = 1.2
  light       = 1.375
  moderate    = 1.55
  active      = 1.725
  very_active = 1.9

Goal adjustments:
  lose     = TDEE - 500
  maintain = TDEE
  gain     = TDEE + 300
```
