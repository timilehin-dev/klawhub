const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

async function applyRLS() {
  try {
    const sqlPath = path.join(__dirname, '../supabase/enable_rls.sql');
    const rlsSql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying RLS policies to all tables...');
    
    // We run as unsafe because the script contains multiple statements and DO blocks
    await sql.unsafe(rlsSql);

    console.log('✅ RLS policies applied successfully.');
    
    // Verify
    const policies = await sql`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`;
    console.log(`Total policies active: ${policies.length}`);
    
    await sql.end();
  } catch (err) {
    console.error('❌ Failed to apply RLS policies:', err.message);
    process.exit(1);
  }
}

applyRLS();
