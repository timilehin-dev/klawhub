const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '../src/lib');

try {
  if (fs.existsSync(targetDir)) {
    // Check if empty
    const files = fs.readdirSync(targetDir);
    if (files.length === 0) {
      fs.rmdirSync(targetDir);
      console.log('✅ Successfully removed empty directory: src/lib');
    } else {
      console.log('⚠️ Directory src/lib is not empty. Skipping removal.');
    }
  } else {
    console.log('ℹ️ Directory src/lib does not exist.');
  }
} catch (err) {
  console.error('❌ Failed to remove src/lib:', err.message);
}
