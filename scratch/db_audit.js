const postgres = require('postgres');

const sql = postgres('postgresql://postgres.sabeiuxrflkndpahuczf:Timilehinklawhub@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require');

async function audit() {
  try {
    // 1. List all tables
    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    console.log('=== TABLES IN DATABASE ===');
    tables.forEach(t => console.log('  -', t.tablename));
    console.log('Total tables:', tables.length);
    console.log('');

    // 2. Row counts for each table
    console.log('=== ROW COUNTS ===');
    for (const t of tables) {
      const count = await sql`SELECT count(*) as cnt FROM ${sql(t.tablename)}`;
      console.log(`  ${t.tablename}: ${count[0].cnt} rows`);
    }
    console.log('');

    // 3. Check for RLS policies
    const policies = await sql`SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename`;
    console.log('=== RLS POLICIES ===');
    if (policies.length === 0) {
      console.log('  WARNING: No RLS policies found!');
    } else {
      policies.forEach(p => console.log(`  ${p.tablename}: ${p.policyname} (${p.cmd})`));
    }
    console.log('');

    // 4. Check for indexes
    const indexes = await sql`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      ORDER BY tablename, indexname
    `;
    console.log('=== INDEXES ===');
    indexes.forEach(i => console.log(`  ${i.tablename}: ${i.indexname}`));
    console.log('Total indexes:', indexes.length);
    console.log('');

    // 5. Check columns for key tables
    const keyTables = ['workspaces', 'integrations', 'schedules', 'runs', 'tasks', 'memory', 'knowledge', 'usage_logs', 'processed_events', 'agent_states'];
    for (const tableName of keyTables) {
      try {
        const cols = await sql`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${tableName}
          ORDER BY ordinal_position
        `;
        console.log(`=== COLUMNS: ${tableName} ===`);
        cols.forEach(c => console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'} ${c.column_default ? `DEFAULT ${c.column_default}` : ''}`));
        console.log('');
      } catch (e) {
        console.log(`  Table ${tableName} does not exist!`);
      }
    }

    // 6. Check extensions
    const extensions = await sql`SELECT extname, extversion FROM pg_extension ORDER BY extname`;
    console.log('=== EXTENSIONS ===');
    extensions.forEach(e => console.log(`  ${e.extname}: v${e.extversion}`));
    console.log('');

    // 7. Check for foreign key constraints
    const fks = await sql`
      SELECT tc.table_name, tc.constraint_name, ccu.table_name AS foreign_table
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name
    `;
    console.log('=== FOREIGN KEYS ===');
    fks.forEach(f => console.log(`  ${f.table_name} -> ${f.foreign_table} (${f.constraint_name})`));
    console.log('');

    await sql.end();
    console.log('=== AUDIT COMPLETE ===');
  } catch (e) {
    console.error('AUDIT ERROR:', e.message);
    console.error(e.stack);
    await sql.end();
  }
}

audit();
