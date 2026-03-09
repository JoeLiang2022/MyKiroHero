const fs = require('fs');
const payload = fs.readFileSync('scripts/email-payload.txt', 'utf8').trim();
// Output as JSON for easy copy
console.log(JSON.stringify({ raw: payload }));
