/**
 * tests/setup.js
 * Global Jest setup: in-memory MongoDB via mongodb-memory-server.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.DB_URI       = uri;
  process.env.JWT_SECRET   = 'test_jwt_secret_key_1234567890';
  process.env.NODE_ENV     = 'test';
  process.env.GROQ_API_KEY = 'test_groq_key';
  process.env.DATA_GOV_API_KEY = 'test_usda_key';

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

afterEach(async () => {
  // Clear all collections between tests
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
