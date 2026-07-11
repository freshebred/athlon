require('dotenv').config();
const mongoose = require('mongoose');
const DailyBalance = require('./models/DailyBalance');
const MealLog = require('./models/MealLog');
const WorkoutLog = require('./models/WorkoutLog');

mongoose.connect(process.env.DB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const balances = await DailyBalance.find({});
    for (const balance of balances) {
      const meals = await MealLog.find({ userId: balance.userId, localDate: balance.localDate, isDeleted: false });
      const workouts = await WorkoutLog.find({ userId: balance.userId, localDate: balance.localDate });
      
      const consumed = meals.reduce((sum, m) => sum + (m.totalCalories || 0), 0);
      const burnt = workouts.reduce((sum, w) => sum + (w.finalCaloriesBurnt ?? w.caloriesBurnt ?? 0), 0);
      
      balance.caloriesConsumed = consumed;
      balance.caloriesBurnt = burnt;
      
      const ob = balance.openingBalance || 2000;
      balance.openingBalance = ob;
      
      balance.currentBalance = ob + (balance.carryover || 0) - consumed + burnt;
      await balance.save();
      console.log(`Fixed balance for user ${balance.userId} on ${balance.localDate}: Consumed=${consumed}, Burnt=${burnt}, Balance=${balance.currentBalance}`);
    }
    console.log('Done.');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
