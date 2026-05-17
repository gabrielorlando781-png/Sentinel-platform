const fetch = require('node-fetch');
require('dotenv').config();
const jwt = require('jsonwebtoken');

function signToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

async function test() {
    const token = signToken({ id: '4dff1a6e-4364-474d-b8a0-82d5f310c138', email: 'teste@email.com', role: 'user', name: 'teste' });
    
    const body = {
        type: 'TESTE DE QUEDA',
        severity: 'high',
        confidence: 95,
        description: 'Teste',
        screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAoHBwkHBgoJCAkLCwoMDxkQDw4ODx4WFxIZJCAmJSMgIyIoLTkwKCo2MzIlNzQ3PD1AQERFJy85RE9CTkc1QEX/2wBDAs',
        modules: ['TEST']
    };

    console.log("Posting alert...");
    const res = await fetch('http://localhost:3000/api/alert', {
        method: 'POST',
        headers: { 
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    const json = await res.json();
    console.log("Status:", res.status);
    console.log("Body:", json);
}
test();
