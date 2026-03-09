const fs = require('fs');
const https = require('https');

// Read credentials
const creds = JSON.parse(fs.readFileSync(
  require('os').homedir() + '/.gmail-mcp/credentials.json', 'utf8'
));

// Read the raw email payload
const raw = fs.readFileSync('scripts/email-payload.txt', 'utf8').trim();

// Refresh access token first
const keys = JSON.parse(fs.readFileSync(
  require('os').homedir() + '/.gmail-mcp/gcp-oauth.keys.json', 'utf8'
));
const clientId = keys.installed?.client_id || keys.web?.client_id;
const clientSecret = keys.installed?.client_secret || keys.web?.client_secret;

const refreshData = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  refresh_token: creds.refresh_token,
  grant_type: 'refresh_token'
}).toString();

const refreshReq = https.request({
  hostname: 'oauth2.googleapis.com',
  path: '/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(refreshData)
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    const token = JSON.parse(body).access_token;
    if (!token) {
      console.error('Failed to refresh token:', body);
      process.exit(1);
    }
    sendEmail(token);
  });
});
refreshReq.write(refreshData);
refreshReq.end();

function sendEmail(accessToken) {
  const postData = JSON.stringify({ raw });
  const req = https.request({
    hostname: 'gmail.googleapis.com',
    path: '/gmail/v1/users/me/messages/send',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Response:', body);
    });
  });
  req.write(postData);
  req.end();
}
