const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://postgres.sabeiuxrflkndpahuczf:Timilehinklawhub@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?pgbouncer=true",
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('Connected to Supabase successfully');
    
    // Get list of tables
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log('Tables in database:');
    res.rows.forEach(row => console.log(`- ${row.table_name}`));
    
    client.release();
  } catch (err) {
    console.error('Database connection error:', err.message);
  } finally {
    await pool.end();
  }
}

testConnection();