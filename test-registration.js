const http = require('http');

function makeRequest(options, data) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(body)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: body
                    });
                }
            });
        });
        
        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

async function testRegistration() {
    const testEmail = `test${Date.now()}@example.com`;
    const testData = {
        email: testEmail,
        password: 'test123456',
        full_name: 'Test User'
    };

    console.log('Testing registration with email:', testEmail);
    console.log('Request data:', testData);
    console.log('\n--- Sending POST /auth/register ---\n');

    const options = {
        hostname: 'localhost',
        port: 8000,
        path: '/auth/register',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };

    try {
        const result = await makeRequest(options, testData);
        
        console.log('Response Status:', result.status);
        console.log('Response Data:', JSON.stringify(result.data, null, 2));
        
        if (result.status === 201 && result.data.status) {
            console.log('\n✓ Registration successful!');
            console.log('✓ User created:', result.data.data.user.email);
            console.log('✓ API Key generated:', result.data.data.api_key);
            console.log('✓ Token generated:', result.data.data.token ? 'Yes' : 'No');
            
            // Test login with the same credentials
            console.log('\n--- Testing Login ---\n');
            const loginOptions = {
                hostname: 'localhost',
                port: 8000,
                path: '/auth/login',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };
            
            const loginResult = await makeRequest(loginOptions, {
                email: testData.email,
                password: testData.password
            });
            
            console.log('Login Response Status:', loginResult.status);
            console.log('Login Response Data:', JSON.stringify(loginResult.data, null, 2));
            
            if (loginResult.status === 200 && loginResult.data.status) {
                console.log('\n✓ Login successful!');
                console.log('✓ User authenticated:', loginResult.data.data.user.email);
                console.log('✓ API Key retrieved:', loginResult.data.data.api_key ? 'Yes' : 'No');
            } else {
                console.log('\n✗ Login failed!');
            }
            
        } else {
            console.log('\n✗ Registration failed!');
        }
    } catch (error) {
        console.error('\n✗ Error:', error.message);
    }
}

testRegistration();