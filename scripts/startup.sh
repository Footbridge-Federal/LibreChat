#!/bin/sh
set -e

echo "🚀 Starting Airwall Chat..."

# Check if this is first deploy by checking MongoDB
echo "📊 Checking if initialization is needed..."

# Use node to check MongoDB for model access rules
NEEDS_INIT=$(node -e "
const mongoose = require('mongoose');
const mongoUri = process.env.MONGO_URI;

(async () => {
  try {
    await mongoose.connect(mongoUri, { bufferCommands: false });
    const count = await mongoose.connection.db.collection('modelaccesses').countDocuments({ configSource: 'git' });
    console.log(count === 0 ? 'true' : 'false');
    await mongoose.disconnect();
  } catch (err) {
    console.error('MongoDB check failed:', err.message);
    console.log('true'); // If check fails, assume we need init
    process.exit(1);
  }
})();
")

if [ "$NEEDS_INIT" = "true" ]; then
  echo "🔄 First deploy detected - running initial sync..."
  npm run sync:config || {
    echo "❌ Initial sync failed!"
    exit 1
  }
  echo "✅ Initial sync complete"
else
  echo "✅ Already initialized - skipping sync"
  echo "   (Run 'npm run sync:config' manually to update config)"
fi

echo "🌐 Starting backend server..."
exec npm run backend
