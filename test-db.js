require('dotenv').config();
const database = require('./database');

async function testDatabase() {
    console.log('Testing database connection...');
    
    try {
        // Wait a bit for initialization to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test connection
        const isConnected = await database.testConnection();
        
        if (isConnected) {
            console.log('✓ Database connection successful!');
            
            // Wait a bit more for tables to be ready
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check database stats
            const stats = await database.getDatabaseStats();
            console.log('Database stats:', stats);
            
            return true;
        } else {
            console.log('✗ Database connection failed!');
            return false;
        }
    } catch (error) {
        console.error('✗ Database test error:', error.message);
        return false;
    } finally {
        await database.close();
    }
}

testDatabase().then(success => {
    process.exit(success ? 0 : 1);
});