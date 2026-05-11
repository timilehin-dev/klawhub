const postgres = require('postgres');

const sql = postgres('postgresql://postgres.sabeiuxrflkndpahuczf:Timilehinklawhub@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require');

async function addIndexes() {
  console.log('Adding performance indexes...\n');

  const indexes = [
    { name: 'idx_runs_workspace_status', table: 'runs', columns: 'workspace_id, status' },
    { name: 'idx_tasks_workspace_status', table: 'tasks', columns: 'workspace_id, status' },
    { name: 'idx_schedules_team_active', table: 'schedules', columns: 'slack_team_id, is_active' },
    { name: 'idx_usage_logs_workspace_created', table: 'usage_logs', columns: 'workspace_id, created_at DESC' },
    { name: 'idx_integrations_workspace_provider', table: 'integrations', columns: 'workspace_id, provider' },
    { name: 'idx_memory_workspace_user', table: 'memory', columns: 'workspace_id, slack_user_id' },
    { name: 'idx_processed_events_created', table: 'processed_events', columns: 'created_at' },
  ];

  for (const idx of indexes) {
    try {
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.columns})`);
      console.log(`  ✅ ${idx.name} on ${idx.table}(${idx.columns})`);
    } catch (e) {
      console.log(`  ❌ ${idx.name}: ${e.message}`);
    }
  }

  console.log('\nDone. Cleaning up...');
  await sql.end();
}

addIndexes();
