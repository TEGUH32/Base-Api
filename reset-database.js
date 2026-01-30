require('dotenv').config();
const { Pool } = require('pg');

async function resetDatabase() {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
        console.error('DATABASE_URL not found in environment variables');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to database...');
        
        // Drop all tables in correct order (respecting foreign keys)
        const tables = [
            'usage_logs',
            'password_reset_tokens',
            'sessions',
            'api_keys',
            'users'
        ];

        for (const table of tables) {
            try {
                await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
                console.log(`✓ Dropped table: ${table}`);
            } catch (error) {
                console.log(`  Note: ${table} may not exist or was already dropped`);
            }
        }

        console.log('\n✓ Database reset complete!');
        console.log('Please restart the application to recreate tables with correct schema.');
        
    } catch (error) {
        console.error('✗ Error resetting database:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

resetDatabase();