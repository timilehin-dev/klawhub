#!/usr/bin/env node
const { execSync } = require('child_process');

const command = process.argv[2];

if (command === 'push') {
  console.log('\n🚀 Starting Klawhub Database Sync...');
  try {
    console.log('1. Pushing schema to Supabase...');
    execSync('npm run db:push', { stdio: 'inherit' });
    console.log('\n✅ Database is fully synced and hardened.');
  } catch (err) {
    console.error('\n❌ Database sync failed.');
    process.exit(1);
  }
} else {
  console.log('\nUsage: node db push');
  console.log('Or: npm run db:push');
}
