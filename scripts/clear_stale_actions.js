const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const PTConversation = require('../models/PTConversation');
const MealLog = require('../models/MealLog');

async function run() {
  try {
    await mongoose.connect(process.env.DB_URI);
    console.log('Connected to DB');

    const convos = await PTConversation.find({ 'pendingActions.status': 'pending' });
    let count = 0;

    for (const convo of convos) {
      let modified = false;
      for (const action of convo.pendingActions) {
        if (action.status === 'pending') {
          action.status = 'rejected';
          modified = true;
          count++;

          // Clean up draft docs if any
          if (action.data && action.data.draftDocId) {
            if (action.type === 'log_food') {
              await MealLog.updateOne({ _id: action.data.draftDocId }, { status: 'rejected' });
            }
          }
        }
      }
      if (modified) {
        await convo.save();
      }
    }

    console.log(`Cleared ${count} stale pending actions.`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

run();
